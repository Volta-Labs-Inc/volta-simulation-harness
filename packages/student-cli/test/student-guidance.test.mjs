import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FileBackedMockStudentService } from "../src/mock-service.ts";
import { commandHelp } from "../src/help.ts";
import { createStudentFixture } from "./fixture.ts";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const value = createStudentFixture();
  roots.push(value.root, value.serviceRoot);
  value.state.useAuthoredRoutes = true;
  value.state.scriptedActions = [];
  fs.writeFileSync(path.join(value.serviceRoot, value.statePath), JSON.stringify(value.state));
  return value;
}

async function session(value) {
  const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath);
  const login = await service.execute({ kind: "login", operationId: "guidance-login" });
  const token = login.token;
  return {
    service,
    token,
    talk: (operationId, question) =>
      service.execute({ kind: "talk", operationId, personaId: "library-manager", question }, token),
    evidence: (operationId, question) =>
      service.execute({ kind: "evidence", operationId, evidenceSourceId: "desk-log", question }, token),
    status: async () => (await service.execute({ kind: "status" }, token)).view,
  };
}

function exampleQuestion(command) {
  return /--question "([^"]+)"/u.exec(commandHelp(command))?.[1];
}

describe("the public example answers what it promises", () => {
  test("Morgan explains the intake process her brief advertises", async () => {
    const { talk } = await session(fixture());
    for (const [id, question] of [
      ["intake-1", "Can you explain the current intake process?"],
      ["intake-2", "How are patron questions handled today?"],
      ["intake-3", "Walk me through how a question gets routed."],
    ]) {
      const reply = await talk(id, question);
      expect(reply.event.officialFactIds, question).toEqual(["intake-process"]);
    }
  });

  test("every shipped help example releases at least one fact", async () => {
    const { talk, evidence } = await session(fixture());
    const talkReply = await talk("help-talk", exampleQuestion("talk"));
    const evidenceReply = await evidence("help-evidence", exampleQuestion("evidence"));
    expect(talkReply.event.officialFactIds.length).toBeGreaterThan(0);
    expect(evidenceReply.event.officialFactIds).toEqual(["log-median-wait"]);
  });

  test("the desk log answers sample size and spread separately from the median", async () => {
    const { evidence } = await session(fixture());
    expect((await evidence("size", "How many rows are in the sample?")).event.officialFactIds).toEqual(["log-sample-size"]);
    expect((await evidence("spread", "What is the range of response times?")).event.officialFactIds).toEqual(["log-wait-range"]);
    expect((await evidence("median", "What is the typical response time?")).event.officialFactIds).toEqual(["log-median-wait"]);
  });

  test("an accuracy question gets an authored refusal, not a generic miss", async () => {
    const { talk } = await session(fixture());
    const reply = await talk("accuracy", "How accurate are the answers patrons get?");
    expect(reply.event.officialFactIds).toEqual([]);
    expect(reply.message).toMatch(/never measured answer accuracy/u);
  });

  test("an unmatched question says to rephrase or record an unknown", async () => {
    const { talk } = await session(fixture());
    const reply = await talk("van", "What colour is the delivery van?");
    expect(reply.event.officialFactIds).toEqual([]);
    expect(reply.message).toMatch(/rephrase|ask about one specific thing/iu);
    expect(reply.message).toMatch(/record it as an unknown/u);
  });

  test("help examples cite IDs that exist in the public case", () => {
    const example = commandHelp("ledger").split("Example:")[1];
    const factId = /--fact-id (\S+)/u.exec(example)?.[1];
    expect(factId).toBe("log-median-wait");
    for (const command of ["decision", "requirement", "claim"]) {
      expect(commandHelp(command), command).toContain(`--evidence-id evidence-ledger-1-${factId}`);
    }
  });
});

describe("natural questions land on the right authored answer", () => {
  test.each([
    ["Can you walk me through what happens when a patron asks a question at the front desk today?", ["intake-process"]],
    ["How do you decide which questions go to a specialist?", ["intake-process"]],
    ["How often does the specialist collect the paper slips?", ["intake-process"]],
    ["What kinds of questions can the clerk not answer directly?", ["intake-process"]],
    ["How long do patrons wait for an answer?", ["median-wait"]],
    ["Why do you want to reduce the wait time?", ["manager-goal"]],
    ["What is the wait time for questions that go on a slip?", ["intake-process"]],
  ])("persona: %s", async (question, factIds) => {
    const { talk } = await session(fixture());
    expect((await talk("q", question)).event.officialFactIds).toEqual(factIds);
  });

  test.each([
    ["Do patrons complain about waiting?", /no authored answer/iu],
    ["How many specialists are there?", /staffing|unknown/iu],
    ["What is the budget for this?", /budget|unknown/iu],
  ])("persona refuses instead of misleading: %s", async (question, pattern) => {
    const { talk } = await session(fixture());
    const reply = await talk("q", question);
    expect(reply.event.officialFactIds).toEqual([]);
    expect(reply.message).toMatch(pattern);
  });

  test.each([
    ["What does first response time mean in the log?", ["log-first-response-definition"]],
    ["What is the longest wait in the sample?", ["log-wait-range"]],
    ["How many rows are in the sample?", ["log-sample-size"]],
  ])("desk log: %s", async (question, factIds) => {
    const { evidence } = await session(fixture());
    expect((await evidence("q", question)).event.officialFactIds).toEqual(factIds);
  });

  test.each([
    "How accurate are the answers given to patrons?",
    "How many questions per day does the desk handle?",
    "How many questions in the sample were passed to the specialist?",
    "What share of questions are routed to a specialist?",
    "What period does the log cover?",
  ])("desk log never answers with the wrong number: %s", async (question) => {
    const { evidence } = await session(fixture());
    expect((await evidence("q", question)).event.officialFactIds).toEqual([]);
  });
});

describe("replies explain themselves", () => {
  test("a reply says whether it released anything citable, and when it was a repeat", async () => {
    const { talk } = await session(fixture());
    const first = await talk("first", "Can you explain the intake process?");
    expect(first.guidance).toContain("Released fact ID intake-process");
    expect(first.guidance).toContain("ledger --kind fact");
    const repeat = await talk("again", "How are questions handled?");
    expect(repeat.guidance).toMatch(/already had intake-process/u);
    const refusal = await talk("accuracy", "How accurate are the answers?");
    expect(refusal.event.officialFactIds).toEqual([]);
    expect(refusal.guidance).toContain("can be cited by ID");
    expect(refusal.guidance).toContain("ledger --kind unknown");
  });

  test("a ledger reply names the evidence IDs or says why there are none", async () => {
    const value = fixture();
    const { service, token, talk } = await session(value);
    await talk("wait", "What is the wait time?");
    const fact = await service.execute(
      { kind: "ledger", operationId: "fact-1", entry: { kind: "fact", statement: "Median wait is 18 minutes.", officialFactIds: ["median-wait"] } },
      token,
    );
    expect(fact.guidance).toContain("evidence-fact-1-median-wait");
    const unknown = await service.execute(
      { kind: "ledger", operationId: "unknown-1", entry: { kind: "unknown", statement: "Accuracy is unmeasured.", officialFactIds: [] } },
      token,
    );
    expect(unknown.guidance).toContain("only fact entries get an evidence ID");
  });

  test("status shows the case clock", async () => {
    const value = fixture();
    const { status, evidence } = await session(value);
    const before = (await status()).simulatedAt;
    expect(before).toBe(value.state.simulatedAt);
    await evidence("q", "What is the median response time?");
    expect(Date.parse((await status()).simulatedAt) - Date.parse(before)).toBe(15 * 60_000);
  });

  test("a released fact reports the simulated time it cost", async () => {
    const { evidence, talk } = await session(fixture());
    const costly = await evidence("cost", "What is the median response time?");
    expect(costly.simulatedTime).toMatchObject({ advancedBy: { amount: 15, unit: "minutes" } });
    expect(Date.parse(costly.simulatedTime.now)).toBe(Date.parse(costly.event.simulatedAt));
    const miss = await talk("free", "What colour is the delivery van?");
    expect(miss.simulatedTime).toBeUndefined();
  });

  test("reflection prompts appear only after meaningful events", async () => {
    const value = fixture();
    const { service, token, talk } = await session(value);
    expect((await talk("released", "What is the wait time?")).checkpointPrompts.length).toBeGreaterThan(0);
    expect((await talk("nothing", "What colour is the delivery van?")).checkpointPrompts).toEqual([]);
    const ledger = await service.execute(
      { kind: "ledger", operationId: "ledger-1", entry: { kind: "unknown", statement: "Accuracy is unmeasured.", officialFactIds: [] } },
      token,
    );
    expect(ledger.checkpointPrompts).toEqual([]);
    const decision = await service.execute(
      { kind: "decision", operationId: "decision-1", decision: value.draft.decision },
      token,
    );
    expect(decision.checkpointPrompts.length).toBeGreaterThan(0);
  });

  test("a review suggestion says why and what to do, and the request itself is not another suggestion", async () => {
    const value = fixture();
    const { service, token } = await session(value);
    const decision = await service.execute(
      { kind: "decision", operationId: "decision-1", decision: value.draft.decision },
      token,
    );
    expect(decision.reviewSuggested).toBe(true);
    expect(decision.reviewSuggestion.reason).toMatch(/decision/u);
    expect(decision.reviewSuggestion.nextStep).toContain("review-request");
    const request = await service.execute(
      { kind: "review-request", operationId: "review-1", topic: "Check my decision", studentChoice: "continue" },
      token,
    );
    expect(request.reviewSuggested).toBe(false);
    expect(request.reviewSuggestion).toBeUndefined();
    expect(request.message).toContain("reviewUpdates");
  });

  test("every recording command returns what it recorded", async () => {
    const value = fixture();
    const { service, token } = await session(value);
    const draft = value.draft;
    const estimate = await service.execute({ kind: "estimate", operationId: "est-1", estimate: draft.estimates[0] }, token);
    expect(estimate.recorded).toEqual({ kind: "estimate", estimateId: "estimate-est-1" });
    const decision = await service.execute({ kind: "decision", operationId: "dec-1", decision: draft.decision }, token);
    expect(decision.recorded).toEqual({ kind: "decision", decisionId: "decision-dec-1" });
    const requirement = await service.execute(
      { kind: "requirement", operationId: "req-1", requirementId: "patron-wait", status: "not-yet", rationale: "Baseline only.", evidenceIds: [] },
      token,
    );
    expect(requirement.recorded).toEqual({ kind: "requirement", requirementId: "patron-wait" });
    const claim = await service.execute(
      { kind: "claim", operationId: "claim-1", competencyId: "problem-viability", rationale: "Waits are long.", evidenceIds: [] },
      token,
    );
    expect(claim.recorded).toEqual({ kind: "claim", competencyId: "problem-viability" });
    const plan = await service.execute(
      {
        kind: "draft", operationId: "draft-1", mode: "no-build", rationale: "Measure first.", feasibility: "Cheap.",
        risks: ["Small sample."], missingDataPlan: "Sample accuracy.", economicRationale: "No invented savings.",
      },
      token,
    );
    expect(plan.recorded).toEqual({ kind: "draft", mode: "no-build" });
  });
});

describe("status stays truthful", () => {
  test("a fact released twice is listed once", async () => {
    const { talk, status } = await session(fixture());
    const before = (await status()).releasedEvidence;
    await talk("first", "What is the wait time?");
    await talk("second", "How long is the wait time now?");
    const after = (await status()).releasedEvidence;
    expect(after.filter(({ factId }) => factId === "median-wait")).toHaveLength(1);
    expect(after.map(({ factId }) => factId)).toEqual([...new Set(after.map(({ factId }) => factId))]);
    expect(after.find(({ factId }) => factId === "median-wait").eventId).toBe(
      before.find(({ factId }) => factId === "median-wait").eventId,
    );
  });

  test("stage follows the student's progress through decision, response, and submission", async () => {
    const value = fixture();
    const { service, token, status } = await session(value);
    expect((await status()).stage).toBe("discovery");
    await service.execute({ kind: "decision", operationId: "dec-1", decision: value.draft.decision }, token);
    expect((await status()).stage).toBe("decision");
    await service.execute(
      {
        kind: "draft", operationId: "draft-1", mode: "no-build", rationale: "Measure first.", feasibility: "Cheap.",
        risks: ["Small sample."], missingDataPlan: "Sample accuracy.", economicRationale: "No invented savings.",
      },
      token,
    );
    expect((await status()).stage).toBe("response");
  });

  test("the artifact rule reads as satisfied, not selected, before any file is chosen", async () => {
    const { status } = await session(fixture());
    const view = await status();
    expect(view.artifactRequirement).toEqual({ required: false, satisfied: true, minimumCount: 0 });
    expect(view.artifactRequirement.selected).toBeUndefined();
  });
});
