/* global document, location, window */

import {
  COMPETENCY_IDS,
  exportEvaluationCsv,
  inertArtifactView,
  previewHumanEvaluation,
} from "/dist/index.js";
import { staffDashboardAdapter } from "/web/adapter.js";
import { assignmentQueueDetail } from "/web/queue-detail.js";
import { submissionReasoningSections } from "/web/submission-reasoning.js";

globalThis.__artifactExecuted = false;

const competencyLabels = {
  "problem-viability": ["01", "Problem viability", "Is this a specific, worthwhile problem?"],
  "evidence-sufficiency": ["02", "Evidence sufficiency", "Is the decision supported, bounded, and honest about unknowns?"],
  "response-feasibility": ["03", "Response feasibility", "Is the proposed action proportionate and feasible?"],
  "objective-success-criteria": ["04", "Objective criteria", "Can success and failure be observed without interpretation?"],
};

const state = {
  route: "assignments",
  activeSection: "record",
  activeAssignmentId: null,
  activeCaseId: null,
  activeArtifact: null,
  refreshCount: 0,
  exportPreview: "",
  snapshot: null,
  loadError: "",
};

function routeFromHash() {
  const value = location.hash.slice(1);
  if (value.startsWith("cases/")) {
    state.route = "case-record";
    state.activeCaseId = decodeURIComponent(value.slice("cases/".length));
    return;
  }
  if (value.startsWith("assignments/")) {
    state.route = "assignments";
    state.activeAssignmentId = decodeURIComponent(value.slice("assignments/".length));
    return;
  }
  state.route = value === "cases" ? "cases" : "assignments";
}

function activeBundle() {
  return state.snapshot.assignments.find(
    ({ assignment: item }) => item.assignmentId === state.activeAssignmentId,
  );
}

function activeOperation(collection) {
  return state.snapshot.operations[collection][state.activeAssignmentId] ?? null;
}

function activeAttemptOperation(collection) {
  const record = activeOperation(collection);
  return record?.attemptNumber === activeBundle().assignment.attemptNumber ? record : null;
}

function activeReviewResponses() {
  const history = state.snapshot.operations.history.reviewResponses[state.activeAssignmentId];
  return (history ?? [activeAttemptOperation("reviewResponses")].filter(Boolean))
    .filter(({ attemptNumber }) => attemptNumber === activeBundle().assignment.attemptNumber);
}

function operationId(prefix) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function el(tagName, options = {}, children = []) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.id) node.id = options.id;
  if (options.type) node.type = options.type;
  if (options.name) node.name = options.name;
  if (options.value !== undefined) node.value = options.value;
  if (options.placeholder) node.placeholder = options.placeholder;
  if (options.ariaLabel) node.setAttribute("aria-label", options.ariaLabel);
  if (options.data) {
    for (const [key, value] of Object.entries(options.data)) node.dataset[key] = value;
  }
  for (const child of children) node.append(child);
  return node;
}

function button(text, onClick, options = {}) {
  const node = el("button", { ...options, type: "button", text });
  node.addEventListener("click", onClick);
  return node;
}

function sourceStamp(text) {
  return el("span", { className: "source-stamp", text });
}

function statusPill(text, tone = "neutral") {
  return el("span", { className: `status-pill status-${tone}`, text });
}

function sectionHeader(kicker, title, detail) {
  return el("header", { className: "section-header" }, [
    el("p", { className: "eyebrow", text: kicker }),
    el("h2", { text: title }),
    el("p", { className: "section-detail", text: detail }),
  ]);
}

function renderCases() {
  const page = el("div", { className: "index-page" });
  page.append(
    el("header", { className: "index-heading" }, [
      el("div", {}, [
        el("p", { className: "eyebrow", text: "CASE LIBRARY / AUTHORITATIVE STATE" }),
        el("h1", { text: "Cases" }),
      ]),
      el("p", {
        className: "index-intro",
        text: "Validation, approval, publication, and assignment readiness are distinct records. No status is inferred in this browser.",
      }),
    ]),
  );
  const list = el("section", { className: "case-index", ariaLabel: "Case records" });
  for (const [index, item] of state.snapshot.cases.entries()) {
    const tone = item.state === "published" ? "green" : item.state === "ready-for-approval" ? "amber" : "neutral";
    list.append(
      el("article", { className: "case-row" }, [
        el("span", { className: "case-number", text: String(index + 1).padStart(2, "0") }),
        el("div", { className: "case-copy" }, [
          el("div", { className: "case-title-line" }, [
            el("h2", { text: item.title }),
            statusPill(item.state.replaceAll("-", " "), tone),
          ]),
          el("p", { text: item.detail }),
          el("div", { className: "micro-row" }, [sourceStamp(item.source), el("span", { text: item.version })]),
        ]),
        button("Open record", () => {
          state.route = "case-record";
          state.activeCaseId = item.caseId;
          location.hash = `cases/${encodeURIComponent(item.caseId)}`;
          render();
        }, { className: "text-button" }),
      ]),
    );
  }
  page.append(list);
  return page;
}

function renderCaseRecord() {
  const item = state.snapshot.cases.find(({ caseId }) => caseId === state.activeCaseId);
  if (item === undefined) {
    return el("section", { className: "empty-state" }, [
      sectionHeader("CASE RECORD", "Case not found", "The selected case is not present in the current adapter snapshot."),
      button("Back to cases", () => {
        state.route = "cases";
        location.hash = "cases";
        render();
      }, { className: "secondary-action" }),
    ]);
  }
  const relatedAssignments = state.snapshot.assignments.filter(
    ({ assignment: candidate }) => candidate.caseId === item.caseId,
  );
  const readiness =
    item.state === "published"
      ? "This exact version is published and may be assigned."
      : item.state === "ready-for-approval"
        ? "This exact version still needs a human approval decision before publication."
        : "This version is not ready to assign.";
  return el("article", { className: "case-record-page" }, [
    button("← Back to cases", () => {
      state.route = "cases";
      location.hash = "cases";
      render();
    }, { className: "text-button" }),
    el("div", { className: "case-record-hero" }, [
      el("div", {}, [
        el("p", { className: "eyebrow", text: "AUTHORITATIVE CASE RECORD" }),
        el("h1", { text: item.title }),
        el("p", { className: "section-detail", text: item.detail }),
      ]),
      statusPill(item.state.replaceAll("-", " "), item.state === "published" ? "green" : "amber"),
    ]),
    el("div", { className: "case-record-grid" }, [
      el("article", {}, [el("h3", { text: "Exact version" }), el("p", { text: item.version }), sourceStamp(item.source)]),
      el("article", {}, [el("h3", { text: "Assignment readiness" }), el("p", { text: readiness })]),
      el("article", {}, [
        el("h3", { text: "Linked assignments" }),
        el("p", {
          text:
            relatedAssignments.length === 0
              ? "No assignments currently use this version."
              : relatedAssignments
                  .map(({ assignment: candidate }) => `${candidate.studentLabel} · ${candidate.lifecycleState}`)
                  .join(" · "),
        }),
      ]),
    ]),
  ]);
}

function renderAssignmentRail() {
  const rail = el("aside", { className: "assignment-rail", ariaLabel: "Assignment index" });
  rail.append(
    el("div", { className: "rail-heading" }, [
      el("p", { className: "eyebrow", text: "ASSIGNMENTS" }),
      el("span", {
        className: "queue-count",
        text: String(state.snapshot.assignments.length).padStart(2, "0"),
      }),
    ]),
  );
  for (const bundle of state.snapshot.assignments) {
    const item = bundle.assignment;
    const response = state.snapshot.operations.reviewResponses[item.assignmentId];
    const evaluation = state.snapshot.operations.evaluations[item.assignmentId];
    const queueDetail = assignmentQueueDetail(bundle, response, evaluation);
    const card = button("", () => {
      state.activeAssignmentId = item.assignmentId;
      state.activeSection = "record";
      state.activeArtifact = bundle.artifacts?.[0]?.artifactId ?? null;
      location.hash = `assignments/${encodeURIComponent(item.assignmentId)}`;
      render();
    }, {
      className: `assignment-card${item.assignmentId === state.activeAssignmentId ? " is-current" : ""}`,
      ariaLabel: `${item.lifecycleState} ${item.studentLabel} ${item.caseTitle} ${queueDetail}`,
    });
    card.append(
      el("span", {
        className: "assignment-state",
        text: `${item.lifecycleState.toUpperCase()}${item.attemptNumber ? ` · A${item.attemptNumber}` : ""}`,
      }),
      el("strong", { text: item.studentLabel }),
      el("span", { text: item.caseTitle }),
      el("small", { text: queueDetail }),
    );
    rail.append(card);
  }
  rail.append(
    el("div", { className: "rail-note" }, [
      sourceStamp("PERSISTED SERVICE STATE"),
      el("p", { text: "Queue labels reflect stored assignment and provider readback, never browser optimism." }),
    ]),
  );
  return rail;
}

function renderTimeline() {
  const bundle = activeBundle();
  const reviewResponses = activeReviewResponses();
  const timeline = el("ol", { className: "timeline", ariaLabel: "Official assignment activity" });
  for (const event of bundle.assignment.timeline) {
    const time = new Date(event.occurredAt).toLocaleTimeString("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const facts = [...event.officialFactIds, ...event.releasedEvidenceIds];
    timeline.append(
      el("li", { className: "timeline-event" }, [
        el("div", { className: "timeline-axis" }, [
          el("time", { text: time }),
          el("span", { className: "timeline-dot", ariaLabel: "Official event" }),
        ]),
        el("article", {}, [
          el("div", { className: "timeline-meta" }, [
            sourceStamp(event.source),
            el("span", { text: event.kind.replaceAll("-", " ") }),
            el("span", { text: event.actorLabel }),
          ]),
          el("h3", { text: event.title }),
          el("p", { text: event.detail }),
          ...(facts.length > 0
            ? [el("div", { className: "id-list" }, facts.map((fact) => el("code", { text: fact })))]
            : []),
        ]),
      ]),
    );
  }
  for (const reviewResponse of reviewResponses) {
    const responseTime = new Date(reviewResponse.respondedAt).toLocaleTimeString("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    timeline.append(
      el("li", { className: "timeline-event new-event" }, [
        el("div", { className: "timeline-axis" }, [
          el("time", { text: responseTime }),
          el("span", { className: "timeline-dot", ariaLabel: "Official event" }),
        ]),
        el("article", {}, [
          el("div", { className: "timeline-meta" }, [
            sourceStamp("OFFICIAL EVENT STORE"),
            el("span", { text: "review response" }),
            el("span", { text: "Matt" }),
          ]),
          el("h3", { text: "Review response recorded" }),
          el("code", { text: reviewResponse.reviewRequestId }),
          ...((bundle.reviewHistory ?? []).filter(({ reviewRequestId }) => reviewRequestId === reviewResponse.reviewRequestId)
            .map(({ topic }) => el("blockquote", { text: topic }))),
          el("p", { text: reviewResponse.responseText }),
          statusPill("sandbox remained available", "green"),
        ]),
      ]),
    );
  }
  return timeline;
}

function renderReviewDesk() {
  const bundle = activeBundle();
  const reviewResponse = activeAttemptOperation("reviewResponses");
  const response = el("textarea", {
    id: "review-response-text",
    name: "review-response",
    placeholder: "Respond with guidance, boundaries, or a question…",
    ariaLabel: "Review response",
  });
  response.rows = 4;
  const send = button("Record response", async () => {
    try {
      state.snapshot = await staffDashboardAdapter.recordReviewResponse({
        operationId: operationId("review-response"),
        assignmentId: bundle.assignment.assignmentId,
        reviewRequestId: bundle.reviewRequest.reviewRequestId,
        responseText: response.value,
      });
      render();
      document.querySelector("#review-confirmation")?.focus();
    } catch (error) {
      response.setAttribute("aria-invalid", "true");
      response.setCustomValidity(error instanceof Error ? error.message : "Invalid response");
      response.reportValidity();
    }
  }, { className: "primary-action" });
  if (reviewResponse && (!bundle.reviewRequest || bundle.reviewRequest.reviewRequestId === reviewResponse.reviewRequestId)) {
    return el("section", { className: "review-desk complete" }, [
      sectionHeader("ASYNC REVIEW", "Response recorded", "The student could continue sandbox work before and after this response."),
      el("p", { id: "review-confirmation", className: "recorded-response", text: reviewResponse.responseText }),
      statusPill("non-blocking · append-only", "green"),
    ]);
  }
  if (!bundle.reviewRequest) {
    return el("section", { className: "review-desk" }, [
      sectionHeader(
        "ASYNC REVIEW",
        "No review response is pending",
        "The student can continue working or submit a new bounded review request.",
      ),
    ]);
  }
  return el("section", { className: "review-desk" }, [
    sectionHeader("ASYNC REVIEW / OPEN", "A boundary question, not a stop sign", bundle.reviewRequest.studentSandboxAvailable
      ? "Student sandbox remains available while this waits for staff."
      : "Sandbox state unavailable."),
    el("blockquote", {
      text:
        bundle.reviewPrompt ??
        "Can the offline routing comparison include a reversible category merge?",
    }),
    el("label", { text: "Staff response" }),
    response,
    el("div", { className: "action-row" }, [send, sourceStamp("SERVER TIME ON SAVE")]),
  ]);
}

function renderSubmissionPacket(packet, packetAttemptNumber) {
  const bundle = activeBundle();
  const submission = packet ?? bundle.submission;
  const attemptNumber = packetAttemptNumber ?? bundle.assignment.attemptNumber;
  if (!submission) {
    const prior = bundle.attemptHistory ?? [];
    return el("section", { className: "submission-packet" }, [
      sectionHeader(
        `ATTEMPT ${bundle.assignment.attemptNumber}`,
        "No accepted submission yet",
        prior.length === 0
          ? "Evaluation remains unavailable until the student service accepts this attempt."
          : `${prior.length} prior accepted attempt remains preserved in immutable history.`,
      ),
    ]);
  }
  const columns = [
    ["Facts", submission.facts.map(({ claim }) => claim)],
    ["Assumptions", submission.assumptions],
    ["Contradictions", submission.contradictions],
    ["Unknowns", submission.unknowns],
  ];
  return el("section", { className: "submission-packet" }, [
    sectionHeader(
      `IMMUTABLE SUBMISSION / ATTEMPT ${attemptNumber}`,
      "The decision packet",
      "Read from the accepted student-service submission · selected artifacts only · no private workspace activity.",
    ),
    el("div", { className: "decision-band" }, [
      el("div", {}, [
        el("span", { className: "eyebrow", text: "RESPONSE MODE" }),
        el("strong", { text: submission.responseMode.replaceAll("-", " ").toUpperCase() }),
      ]),
      el("p", { text: submission.responseSummary }),
    ]),
    el("div", { className: "ledger-grid" }, columns.map(([title, items]) =>
      el("article", {}, [
        el("h3", { text: title }),
        el("ul", {}, items.map((item) => el("li", { text: item }))),
      ]),
    )),
    el("div", { className: "packet-notes" }, [
      el("article", {}, [el("h3", { text: "Missing-data plan" }), el("p", { text: submission.missingDataPlan })]),
      el("article", {}, [el("h3", { text: "Success / failure criteria" }), el("ul", {}, submission.successCriteria.map((item) => el("li", { text: item })))]),
    ]),
    ...submissionReasoningSections(submission.reasoning).map(({ title, items }) =>
      el("article", { className: "reasoning-section" }, [
        el("h3", { text: title }),
        el("ul", {}, items.map((text) => el("li", { text }))),
      ]),
    ),
  ]);
}

function renderReleasedEvidence() {
  const evidenceRecords = activeBundle().releasedEvidence ?? [];
  const list = el("div", { className: "released-evidence-list" });
  for (const evidence of evidenceRecords) {
    list.append(
      el("article", { className: "released-evidence-record" }, [
        el("div", { className: "case-title-line" }, [
          el("h3", { text: evidence.title }),
          sourceStamp(evidence.source),
        ]),
        el("p", { text: evidence.detail }),
        el("div", { className: "artifact-meta" }, [
          sourceStamp(evidence.contentType),
          el("code", { text: evidence.relativePath }),
          ...evidence.supportsOfficialFactIds.map((factId) => el("code", { text: factId })),
        ]),
        el("pre", {
          className: "evidence-preview",
          text: evidence.content,
          ariaLabel: `${evidence.title} contents`,
        }),
      ]),
    );
  }
  return el("section", { className: "released-evidence-room" }, [
    sectionHeader(
      "RELEASED OFFICIAL EVIDENCE",
      "Verify claims against the source",
      "These records were released to the student by the configured assignment authority for this attempt.",
    ),
    list,
  ]);
}

function renderArtifacts() {
  const bundle = activeBundle();
  const artifacts = bundle.artifacts ?? [];
  if (
    artifacts.length === 0 ||
    !bundle.artifactReceipts ||
    !bundle.acceptedSubmission
  ) {
    return el("section", { className: "artifact-room" }, [
      sectionHeader(
        "SELECTED ARTIFACTS",
        "No inspectable artifact was submitted",
        "The accepted response contains no separately receipt-backed artifact for this attempt.",
      ),
    ]);
  }
  const active = artifacts.find(({ artifactId }) => artifactId === state.activeArtifact) ?? artifacts[0];
  const receipt = bundle.artifactReceipts.find(({ artifactId }) => artifactId === active.artifactId);
  const view = inertArtifactView(active, receipt, bundle.acceptedSubmission);
  const tabs = el("div", { className: "artifact-tabs", ariaLabel: "Submitted artifact formats" });
  for (const artifact of artifacts) {
    const tab = button(artifact.label, () => {
      state.activeArtifact = artifact.artifactId;
      render();
    }, { className: artifact.artifactId === active.artifactId ? "is-active" : "" });
    tab.setAttribute("aria-pressed", String(artifact.artifactId === active.artifactId));
    tabs.append(tab);
  }
  const preview = el("pre", { id: "artifact-preview", className: "artifact-preview", text: view.text });
  preview.dataset.displayMode = view.displayMode;
  preview.dataset.executable = String(view.executable);
  preview.dataset.remoteResourcesAllowed = String(view.remoteResourcesAllowed);
  return el("section", { className: "artifact-room" }, [
    sectionHeader("SELECTED ARTIFACTS / INERT PREVIEW", "Observe content. Never execute it.", "HTML, SVG, Markdown, JSON, and CSV are shown as bounded plain text. Remote content is never loaded."),
    tabs,
    el("div", { className: "artifact-meta" }, [sourceStamp(view.contentType), el("code", { text: view.relativePath }), el("span", { text: "PLAIN TEXT" })]),
    preview,
  ]);
}

function ratingSelect(competencyId) {
  const select = el("select", { id: `rating-${competencyId}`, name: `rating-${competencyId}` });
  for (const [value, text] of [
    ["", "Choose a human rating"],
    ["effective", "Effective"],
    ["partially-effective", "Partially effective"],
    ["not-yet-effective", "Not yet effective"],
  ]) {
    const option = el("option", { value, text });
    select.append(option);
  }
  return select;
}

function readEvaluationDraft() {
  const competencies = {};
  for (const competencyId of COMPETENCY_IDS) {
    competencies[competencyId] = {
      rating: document.querySelector(`#rating-${competencyId}`).value,
      rationale: document.querySelector(`#rationale-${competencyId}`).value,
    };
  }
  return {
    competencies,
    overallRationale: document.querySelector("#overall-rationale").value,
  };
}

function renderEvaluation() {
  const bundle = activeBundle();
  const evaluation = activeAttemptOperation("evaluations");
  if (evaluation) return renderSavedEvaluation(evaluation);
  if (!bundle.acceptedSubmission) {
    const priorEvaluation = activeOperation("evaluations");
    return el("section", { className: "evaluation-form" }, [
      sectionHeader(
        "HUMAN EVALUATION",
        "Awaiting an accepted submission",
        priorEvaluation
          ? `Attempt ${priorEvaluation.attemptNumber}'s evaluation remains preserved; Attempt ${bundle.assignment.attemptNumber} needs its own accepted submission.`
          : "The four human judgments become available only after the student service accepts this attempt.",
      ),
    ]);
  }
  const form = el("form", { className: "evaluation-form", id: "evaluation-form" });
  form.addEventListener("input", () => {
    const message = document.querySelector("#evaluation-message");
    if (message.classList.contains("is-error")) {
      message.textContent = "Review the updated judgments, then derive the result again.";
      message.className = "form-message";
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const draft = readEvaluationDraft();
    const preview = previewHumanEvaluation(bundle.acceptedSubmission, draft);
    const message = document.querySelector("#evaluation-message");
    message.textContent = preview.canSave
      ? `Derived overall: ${preview.overallRating}. Ready to record.`
      : preview.issues.join(" ");
    message.className = preview.canSave ? "form-message is-ready" : "form-message is-error";
    if (!preview.canSave) return;
    try {
      state.snapshot = await staffDashboardAdapter.recordEvaluation({
        assignmentId: bundle.assignment.assignmentId,
        operationId: operationId("evaluation"),
        draft,
      });
      render();
      document.querySelector("#evaluation-result")?.focus();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Evaluation could not be recorded";
      message.className = "form-message is-error";
    }
  });
  form.append(
    sectionHeader("HUMAN EVALUATION / FOUR REQUIRED", "Judge the reasoning, not resemblance", "No model score. No canonical answer. Overall result is derived after all four judgments and the baseline check."),
    el("div", { className: "baseline-check" }, [
      el("div", {}, [
        el("label", { text: "Accepted baseline readback", data: { for: "baseline-kind" } }),
        (() => {
          const select = el("select", { id: "baseline-kind", name: "baseline-kind" });
          for (const [value, text] of [
            ["missing", "Missing"],
            ["measured-baseline", "Measured baseline"],
            ["credible-baseline-plan", "Credible baseline plan"],
          ]) select.append(el("option", { value, text }));
          select.value = bundle.acceptedSubmission.baselineKind;
          select.disabled = true;
          return select;
        })(),
      ]),
      el("div", {}, [
        el("label", { text: "Accepted evidence or plan detail" }),
        (() => {
          const area = el("textarea", { id: "baseline-detail", name: "baseline-detail", placeholder: "What makes the baseline or plan credible?" });
          area.rows = 3;
          area.value = bundle.acceptedSubmission.baselineDetail;
          area.readOnly = true;
          return area;
        })(),
      ]),
    ]),
  );
  const competencyList = el("div", { className: "competency-list" });
  for (const competencyId of COMPETENCY_IDS) {
    const [number, title, question] = competencyLabels[competencyId];
    const rationale = el("textarea", {
      id: `rationale-${competencyId}`,
      name: `rationale-${competencyId}`,
      placeholder: "Record the evidence for this judgment…",
    });
    rationale.rows = 4;
    competencyList.append(
      el("fieldset", { className: "competency-card" }, [
        el("legend", {}, [el("span", { text: number }), el("strong", { text: title })]),
        el("p", { text: question }),
        el("label", { text: "Human rating" }),
        ratingSelect(competencyId),
        el("label", { text: "Rationale" }),
        rationale,
      ]),
    );
  }
  const overall = el("textarea", {
    id: "overall-rationale",
    name: "overall-rationale",
    placeholder: "Synthesize why these judgments support the derived result…",
  });
  overall.rows = 4;
  form.append(
    competencyList,
    el("div", { className: "overall-rationale" }, [el("label", { text: "Overall human rationale" }), overall]),
    el("p", { id: "evaluation-message", className: "form-message", text: "Overall result unavailable until the four judgments and baseline check are complete." }),
    el("div", { className: "action-row" }, [
      el("button", { className: "primary-action", type: "submit", text: "Derive & record evaluation" }),
      sourceStamp("APPEND-ONLY ON SAVE"),
    ]),
  );
  return form;
}

function renderSavedEvaluation(evaluation) {
  const effectiveCount = COMPETENCY_IDS.filter(
    (competencyId) => evaluation.competencies[competencyId].rating === "effective",
  ).length;
  const overallLabel = evaluation.overallRating
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  const overallDetail =
    evaluation.overallRating === "effective"
      ? "Derived because all four human judgments are effective and a measured baseline or credible plan exists."
      : evaluation.overallRating === "partially-effective"
        ? "Derived because at least one of the four human judgments is below effective."
        : "Derived because all four human judgments are not yet effective.";
  const list = el("div", { className: "saved-competencies" });
  for (const competencyId of COMPETENCY_IDS) {
    const [, title] = competencyLabels[competencyId];
    const judgment = evaluation.competencies[competencyId];
    list.append(
      el("article", {}, [
        el("div", { className: "case-title-line" }, [
          el("h3", { text: title }),
          statusPill(
            judgment.rating.replaceAll("-", " "),
            judgment.rating === "effective"
              ? "green"
              : judgment.rating === "partially-effective"
                ? "amber"
                : "neutral",
          ),
        ]),
        el("p", { text: judgment.rationale }),
      ]),
    );
  }
  const exportButton = button("Prepare neutralized CSV", () => {
    state.exportPreview = exportEvaluationCsv(evaluation);
    render();
  }, { className: "secondary-action", id: "export-evaluation" });
  return el("section", { className: "saved-evaluation", id: "evaluation-result" }, [
    sectionHeader("RECORDED HUMAN EVALUATION", overallLabel, overallDetail),
    el("div", { className: "evaluation-seal" }, [
      el("span", { text: `${effectiveCount}/4` }),
      el("p", { text: "competencies judged effective" }),
    ]),
    list,
    el("p", { className: "overall-copy", text: evaluation.overallRationale }),
    el("div", { className: "action-row" }, [exportButton, sourceStamp("NO CANONICAL ANSWER COMPARED")]),
    ...(state.exportPreview
      ? [el("pre", { id: "csv-export-preview", className: "csv-preview", text: state.exportPreview })]
      : []),
  ]);
}

function renderReplayAndLineage() {
  const bundle = activeBundle();
  const evaluation = activeAttemptOperation("evaluations");
  const storedReplay = activeOperation("replays");
  const storedReopen = activeOperation("reopens");
  const replayPanel = el("section", { className: "replay-panel" }, [
    sectionHeader("PROVIDER REPLAY", "Compare wording. Keep truth fixed.", "Replay can create a linked provider record; it cannot alter facts, evidence, or the human evaluation."),
  ]);
  if (bundle.replayUnavailableReason) {
    const replayButton = button("Replay unavailable", () => {}, {
      className: "primary-action",
      id: "create-replay",
    });
    replayButton.disabled = true;
    replayPanel.append(
      replayButton,
      el("p", { className: "form-message", text: bundle.replayUnavailableReason }),
    );
  } else if (!storedReplay) {
    const replayButton = button("Create linked replay", async () => {
      state.snapshot = await staffDashboardAdapter.createReplay({
        assignmentId: bundle.assignment.assignmentId,
        operationId: operationId("replay"),
      });
      render();
    }, { className: "primary-action", id: "create-replay" });
    replayButton.disabled = evaluation === null;
    replayPanel.append(
      el("article", { className: "provider-record" }, [
        sourceStamp("ORIGINAL / CAPTURE"),
        el("p", { text: bundle.originalProviderRecord.renderedText }),
        el("div", { className: "id-list" }, bundle.originalProviderRecord.officialFactIds.map((id) => el("code", { text: id }))),
      ]),
      replayButton,
      ...(evaluation === null
        ? [el("p", { className: "form-message", text: "Record the human evaluation before creating a replay." })]
        : []),
    );
  } else {
    const replay = storedReplay.comparison;
    replayPanel.append(
      el("div", { className: "replay-grid" }, [
        providerCard("ORIGINAL", replay.original),
        providerCard("LINKED REPLAY", replay.replay),
      ]),
      el("div", { className: "truth-lock" }, [
        statusPill("truth unchanged", "green"),
        statusPill("evaluation unchanged", "green"),
        el("code", { text: `replay-of: ${replay.original.interactionId}` }),
      ]),
    );
  }
  const lineage = el("section", { className: "lineage-panel" }, [
    sectionHeader("ATTEMPT LINEAGE", "Reopen without erasure", "The accepted submission and its evaluation remain immutable. Reopening creates the next active attempt."),
  ]);
  if (!storedReopen || bundle.submission) {
    const nextAttemptNumber = bundle.assignment.attemptNumber + 1;
    const reopenButton = button(`Reopen as Attempt ${nextAttemptNumber}`, async () => {
      state.snapshot = await staffDashboardAdapter.reopenAttempt({
        assignmentId: bundle.assignment.assignmentId,
        operationId: operationId("reopen"),
      });
      render();
    }, { className: "warning-action", id: "reopen-attempt" });
    reopenButton.disabled = evaluation === null || !bundle.submission;
    if (bundle.submission) {
      lineage.append(
        el("article", { className: "attempt-card" }, [
          el("div", { className: "case-title-line" }, [
            el("h3", { text: `Attempt ${bundle.assignment.attemptNumber}` }),
            statusPill(evaluation ? "submitted · evaluated" : "submitted · evaluation open", evaluation ? "green" : "amber"),
          ]),
          el("p", { text: "Submission and human evaluation lock to the recorded digest before reopening." }),
          el("code", { text: bundle.submission.submissionDigest.slice(0, 22) + "…" }),
        ]),
        reopenButton,
      );
    } else {
      lineage.append(
        el("p", { className: "form-message", text: "An accepted submission and its human evaluation are required before reopening." }),
      );
    }
  } else {
    const previousAttemptNumber = storedReopen.result.previous.attemptNumber;
    const nextAttemptNumber = storedReopen.result.next.attemptNumber;
    lineage.append(
      el("div", { className: "attempt-lineage" }, [
        el("article", { className: "attempt-card locked" }, [
          sourceStamp("LOCKED HISTORY"),
          el("h3", { text: `Attempt ${previousAttemptNumber}` }),
          el("p", { text: "Submission and evaluation preserved." }),
          statusPill("immutable", "neutral"),
        ]),
        el("span", { className: "lineage-arrow", text: "→", ariaLabel: "reopened as" }),
        el("article", { className: "attempt-card active" }, [
          sourceStamp("CURRENT ATTEMPT"),
          el("h3", { text: `Attempt ${nextAttemptNumber}` }),
          el("p", { text: "Active with its own future evidence and evaluation." }),
          statusPill("writable sandbox", "green"),
        ]),
      ]),
      el("p", {
        id: "reopen-confirmation",
        className: "confirmation-line",
        text: `Attempt ${nextAttemptNumber} created · Attempt ${previousAttemptNumber} remains locked`,
      }),
    );
  }
  const preservedAttempts = bundle.attemptHistory ?? [];
  if (preservedAttempts.length > 0) {
    lineage.append(
      el("div", { className: "attempt-lineage" }, preservedAttempts.map((attempt) =>
        el("article", { className: "attempt-card locked" }, [
          sourceStamp("PRESERVED ATTEMPT"),
          el("h3", { text: `Attempt ${attempt.attemptNumber}` }),
          el("p", {
            text: attempt.evaluation
              ? `Evaluation preserved · ${attempt.evaluation.overallRating.replaceAll("-", " ")}`
              : "No evaluation record",
          }),
          el("p", {
            text: attempt.reviewResponses?.length
              ? `${attempt.reviewResponses.length} staff review responses preserved`
              : attempt.reviewResponse ? "Staff review response preserved"
              : "No staff review response",
          }),
          ...(attempt.submission ? [el("details", {}, [
            el("summary", { text: `Read Attempt ${attempt.attemptNumber} reasoning` }),
            renderSubmissionPacket(attempt.submission, attempt.attemptNumber),
          ])] : []),
          ...(attempt.reviewResponses ?? []).map((response) => el("details", {}, [
            el("summary", { text: `Review ${response.reviewRequestId}` }),
            ...((attempt.reviewHistory ?? []).filter(({ reviewRequestId }) => reviewRequestId === response.reviewRequestId)
              .map(({ topic }) => el("blockquote", { text: topic }))),
            el("p", { text: response.responseText }),
          ])),
          ...(attempt.reopen
            ? [el("p", { text: `Reopened as Attempt ${attempt.reopen.result.next.attemptNumber}` })]
            : []),
        ]),
      )),
    );
  }
  return el("div", { className: "stack" }, [replayPanel, lineage]);
}

function providerCard(label, record) {
  return el("article", { className: "provider-record" }, [
    sourceStamp(label),
    el("p", { text: record.renderedText }),
    el("dl", { className: "compact-dl" }, [
      el("dt", { text: "Model" }), el("dd", { text: record.modelId }),
      el("dt", { text: "Route" }), el("dd", { text: record.routeId }),
    ]),
  ]);
}

function renderWorkspaceContent() {
  if (state.activeSection === "record") {
    return el("div", { className: "stack" }, [
      renderReviewDesk(),
      renderTimeline(),
      renderSubmissionPacket(),
      renderReleasedEvidence(),
      renderArtifacts(),
    ]);
  }
  if (state.activeSection === "evaluation") return renderEvaluation();
  return renderReplayAndLineage();
}

function renderBlockedAssignment(bundle) {
  const item = bundle.assignment;
  return el("div", { className: "workspace-layout" }, [
    renderAssignmentRail(),
    el("section", { className: "workspace" }, [
      el("header", { className: "workspace-header" }, [
        el("div", {}, [
          el("div", { className: "workspace-kicker" }, [
            sourceStamp("SERVICE + PROVIDER READBACK"),
            statusPill(item.lifecycleState, "amber"),
          ]),
          el("h1", { text: item.caseTitle }),
          el("p", {
            text: `${item.studentLabel} · Attempt ${item.attemptNumber} · ${item.assignmentId}`,
          }),
        ]),
      ]),
      el("div", { className: "workspace-content" }, [
        el("section", { className: "blocked-assignment" }, [
          sectionHeader(
            "ASSIGNMENT BLOCKED / PROVISIONING",
            bundle.blocked.title,
            bundle.blocked.detail,
          ),
          el("dl", { className: "compact-dl" }, [
            el("dt", { text: "Repository readback" }),
            el("dd", { text: item.repositoryReadback }),
            el("dt", { text: "Available staff actions" }),
            el("dd", { text: "None until provider readback succeeds" }),
          ]),
        ]),
      ]),
    ]),
  ]);
}

function renderAssignmentWorkspace() {
  const bundle = activeBundle();
  if (bundle === undefined) {
    return el("section", { className: "empty-state" }, [
      sectionHeader("ASSIGNMENT", "Assignment not found", "The selected assignment is not present in the current adapter snapshot."),
    ]);
  }
  if (bundle.blocked) return renderBlockedAssignment(bundle);
  const staffAssignment = bundle.assignment;
  const page = el("div", { className: "workspace-layout" });
  page.append(renderAssignmentRail());
  const workspace = el("section", { className: "workspace" });
  const refreshText = state.refreshCount === 0 ? "Not refreshed" : `Reconciled · pass ${state.refreshCount}`;
  workspace.append(
    el("header", { className: "workspace-header" }, [
      el("div", {}, [
        el("div", { className: "workspace-kicker" }, [sourceStamp("SERVICE + GITHUB READBACK"), statusPill(staffAssignment.lifecycleState, "green")]),
        el("h1", { text: staffAssignment.caseTitle }),
        el("p", { text: `${staffAssignment.studentLabel} · Attempt ${staffAssignment.attemptNumber} · ${staffAssignment.assignmentId}` }),
      ]),
      el("div", { className: "header-actions" }, [
        el("span", { id: "refresh-status", className: "refresh-status", text: refreshText }),
        button("Refresh official state", async () => {
          state.snapshot = await staffDashboardAdapter.loadDashboard();
          state.refreshCount += 1;
          render();
        }, { className: "secondary-action", id: "refresh-state" }),
      ]),
    ]),
  );
  const tabs = el("nav", { className: "workspace-tabs", ariaLabel: "Assignment workspace sections" });
  for (const [id, label] of [
    ["record", "Evidence record"],
    ["evaluation", "Evaluation"],
    ["lineage", "Replay & lineage"],
  ]) {
    const tab = button(label, () => {
      state.activeSection = id;
      render();
    }, { className: state.activeSection === id ? "is-active" : "", id: `tab-${id}` });
    tab.setAttribute("aria-current", state.activeSection === id ? "page" : "false");
    tabs.append(tab);
  }
  workspace.append(tabs, el("div", { className: "workspace-content" }, [renderWorkspaceContent()]));
  page.append(workspace);
  return page;
}

function render() {
  document.querySelectorAll("[data-route]").forEach((node) => {
    const currentRoute = state.route === "case-record" ? "cases" : state.route;
    node.setAttribute("aria-current", node.dataset.route === currentRoute ? "page" : "false");
  });
  const app = document.querySelector("#app");
  if (state.loadError) {
    app.replaceChildren(
      el("section", { className: "empty-state" }, [
        sectionHeader("STAFF DASHBOARD UNAVAILABLE", "Official state could not be loaded", state.loadError),
      ]),
    );
    return;
  }
  if (state.snapshot === null) {
    app.replaceChildren(
      el("section", { className: "empty-state" }, [
        sectionHeader("STAFF DASHBOARD", "Loading official state", "Waiting for the configured dashboard adapter."),
      ]),
    );
    return;
  }
  document.querySelector("#environment-label").textContent = state.snapshot.environment.label;
  const content =
    state.route === "cases"
      ? renderCases()
      : state.route === "case-record"
        ? renderCaseRecord()
        : renderAssignmentWorkspace();
  app.replaceChildren(content);
}

document.querySelectorAll("[data-route]").forEach((node) => {
  node.addEventListener("click", () => {
    state.route = node.dataset.route;
    location.hash = state.route;
    render();
  });
});

window.addEventListener("hashchange", () => {
  routeFromHash();
  render();
});

async function initialize() {
  routeFromHash();
  render();
  try {
    state.snapshot = await staffDashboardAdapter.loadDashboard();
    if (
      state.activeAssignmentId === null ||
      !state.snapshot.assignments.some(
        ({ assignment: item }) => item.assignmentId === state.activeAssignmentId,
      )
    ) {
      state.activeAssignmentId = state.snapshot.assignments[0]?.assignment.assignmentId ?? null;
    }
    if (
      state.activeCaseId === null ||
      !state.snapshot.cases.some(({ caseId }) => caseId === state.activeCaseId)
    ) {
      state.activeCaseId = state.snapshot.cases[0]?.caseId ?? null;
    }
    state.activeArtifact = activeBundle()?.artifacts?.[0]?.artifactId ?? null;
  } catch (error) {
    state.loadError = error instanceof Error ? error.message : "Unknown adapter failure";
  }
  render();
}

initialize();
