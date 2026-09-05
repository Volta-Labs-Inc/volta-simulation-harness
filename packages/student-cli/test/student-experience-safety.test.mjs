import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { FileBackedMockStudentService } from "../src/mock-service.ts";
import { runCli } from "../src/cli.ts";
import { createStudentFixture } from "./fixture.ts";
import { createCaseVersionDigests } from "../../core/src/case-version.ts";
import { publishCase } from "../../core/src/published-case.ts";
import { sha256Digest } from "../../core/src/canonical.ts";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const value = createStudentFixture();
  roots.push(value.root, value.serviceRoot);
  return value;
}
function save(value) { fs.writeFileSync(path.join(value.serviceRoot, value.statePath), JSON.stringify(value.state)); }
async function session(value) {
  const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath);
  const login = await service.execute({ kind: "login", operationId: "safety-login" });
  return { service, token: login.token };
}
const calculation = {
  name: "Observation cost",
  inputs: [{ name: "hours", value: 2, unit: "hours", source: "Student estimate" }, { name: "rate", value: 10, unit: "CAD/hour", source: "Student assumption" }],
  formula: { operation: "product", inputNames: ["hours", "rate"] },
  result: { value: 999, unit: "CAD" }, rationale: "Estimate effort cost",
};

test("every acknowledged concurrent action survives separate service instances and retries", async () => {
  const value = fixture();
  const { service, token } = await session(value);
  const requests = Array.from({ length: 10 }, (_, i) => ({ kind: "ledger", operationId: `parallel-${i}`, entry: { kind: "unknown", statement: `Research question ${i}`, officialFactIds: [] } }));
  const replies = await Promise.all(requests.map(request => new FileBackedMockStudentService(value.serviceRoot, value.statePath).execute(request, token)));
  expect(replies).toHaveLength(10);
  const view = (await service.execute({ kind: "status" }, token)).view;
  expect(view.capturedLedger).toHaveLength(10);
  expect(new Set(view.capturedLedger.map(({ id }) => id)).size).toBe(10);
  await Promise.all(requests.map(request => service.execute(request, token)));
  expect((await service.execute({ kind: "status" }, token)).view.capturedLedger).toHaveLength(10);
});

test("incorrect arithmetic is rejected before any calculation or receipt is saved", async () => {
  const value = fixture();
  const { service, token } = await session(value);
  await expect(service.execute({ kind: "calculation", operationId: "bad-arithmetic", calculation }, token)).rejects.toMatchObject({ code: "INVALID_CALCULATION" });
  const saved = JSON.parse(fs.readFileSync(path.join(value.serviceRoot, value.statePath), "utf8"));
  expect(saved.workingDraft.calculations ?? []).toEqual([]);
  expect(saved.operations).not.toHaveProperty("bad-arithmetic");
});

test("a legacy bad calculation can be removed, preserving its full history and restoring readiness", async () => {
  const value = fixture();
  value.state.workingDraft = JSON.parse(JSON.stringify(value.draft));
  value.state.workingDraft.calculations.push({ ...calculation, id: "legacy-mistake" });
  save(value);
  const { service, token } = await session(value);
  expect((await service.execute({ kind: "prepare-submission" }, token)).baseReady).toBe(false);
  const removed = await service.execute({ kind: "calculation-remove", operationId: "remove-mistake", calculationId: "legacy-mistake" }, token);
  expect(removed.recorded).toEqual({ kind: "calculation-removal", calculationId: "legacy-mistake" });
  expect((await service.execute({ kind: "prepare-submission" }, token)).baseReady).toBe(true);
  const view = (await service.execute({ kind: "status" }, token)).view;
  expect(view.calculationHistory).toEqual([expect.objectContaining({ kind: "calculation-removed", calculation: { ...calculation, id: "legacy-mistake" } })]);
});

test("the student's calculation-remove command completes the correction workflow", async () => {
  const value = fixture();
  value.state.workingDraft = JSON.parse(JSON.stringify(value.draft));
  save(value);
  const client = new FileBackedMockStudentService(value.serviceRoot, value.statePath);
  const messages = [];
  const options = { assignmentRoot: value.root, client, io: { writeOut: text => messages.push(text), writeError: text => messages.push(text) } };
  expect(await runCli(["login", "--operation-id", "cli-correction-login"], options)).toBe(0);
  expect(await runCli(["calculation-remove", "--operation-id", "cli-correction", "--id", value.draft.calculations[0].id], options)).toBe(0);
  expect(messages.join("\n")).toContain("calculation-removal");
  const saved = JSON.parse(fs.readFileSync(path.join(value.serviceRoot, value.statePath), "utf8"));
  expect(saved.workingDraft.calculations).toHaveLength(0);
  expect(saved.calculationHistory[0].calculation).toEqual(value.draft.calculations[0]);
});

test("the authored pilot distinguishes known wait time from unknown accuracy and budget", async () => {
  const value = fixture();
  value.state.useAuthoredRoutes = true;
  save(value);
  const { service, token } = await session(value);
  const ask = (id, question) => service.execute({ kind: "talk", operationId: id, personaId: "library-manager", question }, token);
  expect((await ask("wait", "What is the wait time?")).event.officialFactIds).toEqual(["median-wait"]);
  for (const [id, question] of [["accuracy", "How accurate are the answers?"], ["budget", "What is your budget?"]]) {
    const reply = await ask(id, question);
    expect(reply.message).toMatch(/not available|unknown|not measured/i);
    expect(reply.event.officialFactIds).toEqual([]);
  }
});

test("authored prerequisites control release and public collection opportunities remain discoverable", async () => {
  const value = fixture();
  const source = JSON.parse(JSON.stringify(value.state.submissionContext.publishedCase.source));
  source.protected.routes[0].prerequisiteFactIds = ["log-median-wait"];
  source.visible.evidenceSources.push({ id: "accuracy-sample", title: "Accuracy observation", kind: "collection-opportunity", studentBrief: "Plan a synthetic observation." });
  const digests = createCaseVersionDigests(source);
  const content = { kind: "validated-case-import", source, recordedVisibleBundleDigest: digests.visibleBundleDigest, recordedProtectedPackageDigest: digests.protectedPackageDigest };
  const publishedCase = publishCase({ ...content, validationDigest: sha256Digest(content) });
  value.state.submissionContext.publishedCase = publishedCase;
  value.state.submissionContext.trustedReleasedState.caseVersionDigest = publishedCase.digests.caseVersionDigest;
  value.state.attempt.caseVersionDigest = publishedCase.digests.caseVersionDigest;
  value.state.useAuthoredRoutes = true;
  value.state.scriptedActions = [];
  save(value);
  const { service, token } = await session(value);
  const before = (await service.execute({ kind: "status" }, token)).view;
  expect(before.availableCollectionMethods).toContainEqual({ id: "accuracy-sample", description: "Plan a synthetic observation." });
  const ask = operationId => service.execute({ kind: "talk", operationId, personaId: "library-manager", question: "What is the wait time?" }, token);
  expect((await ask("before-evidence")).event.officialFactIds).toEqual([]);
  expect((await service.execute({ kind: "evidence", operationId: "get-log", evidenceSourceId: "desk-log", question: "Show response time" }, token)).event.officialFactIds).toEqual(["log-median-wait"]);
  expect((await ask("after-evidence")).event.officialFactIds).toEqual(["median-wait"]);
  const after = JSON.parse(fs.readFileSync(path.join(value.serviceRoot, value.statePath), "utf8"));
  expect(Date.parse(after.simulatedAt) - Date.parse(value.state.simulatedAt)).toBe(25 * 60_000);
});
