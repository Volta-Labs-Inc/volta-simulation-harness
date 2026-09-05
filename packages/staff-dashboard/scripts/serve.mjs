import { createReadStream } from "node:fs";
import { Buffer } from "node:buffer";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import { readMockStudentServiceState } from "@volta-sim/student-cli";
import {
  buildReplayComparison,
  buildStaffAssignmentView,
  createHumanEvaluation,
  createReviewResponse,
  reopenEvaluatedAttempt,
} from "../dist/index.js";
import { createLiveStudentStateDashboard } from "../dist/live-student-state-adapter.js";
import {
  acceptedSubmission,
  artifactReceipts,
  artifacts,
  assignment,
  assignments,
  cases,
  originalProviderRecord,
  providerRecordReceipts,
  provisioningAssignment,
  releasedEvidence,
  replayProviderRecord,
  reviewRequest,
  submission,
} from "../web/fixture.js";
import { createLocalFixtureStore } from "./local-fixture-store.mjs";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const coreRoot = resolve(packageRoot, "../core");
const port = Number(process.env.STAFF_DASHBOARD_PORT ?? 4176);
const storeFile =
  process.env.STAFF_DASHBOARD_STORE_FILE ??
  join(tmpdir(), "volta-simulation-harness", "staff-dashboard-store.json");
const liveStudentStateRoot = process.env.STAFF_DASHBOARD_STUDENT_STATE_ROOT;
const liveStudentStatePath = process.env.STAFF_DASHBOARD_STUDENT_STATE_PATH;
if ((liveStudentStateRoot === undefined) !== (liveStudentStatePath === undefined)) {
  throw new Error(
    "Set both STAFF_DASHBOARD_STUDENT_STATE_ROOT and STAFF_DASHBOARD_STUDENT_STATE_PATH for connected mode",
  );
}
const connectedStudentState =
  liveStudentStateRoot === undefined || liveStudentStatePath === undefined
    ? undefined
    : await readMockStudentServiceState(liveStudentStateRoot, liveStudentStatePath);
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
]);
const mutationRoutes = new Map([
  ["/api/staff-dashboard/review-responses", "review-response"],
  ["/api/staff-dashboard/evaluations", "evaluation"],
  ["/api/staff-dashboard/replays", "replay"],
  ["/api/staff-dashboard/reopens", "reopen"],
]);
const store = createLocalFixtureStore({
  filePath: storeFile,
  assignmentIds:
    connectedStudentState === undefined
      ? assignments.map(({ assignmentId }) => assignmentId)
      : [connectedStudentState.assignmentId],
});
const liveDashboard =
  connectedStudentState === undefined
    ? undefined
    : createLiveStudentStateDashboard({
        serviceStateRoot: liveStudentStateRoot,
        statePath: liveStudentStatePath,
        operationsStore: store,
        staffGithubUserId: "99101",
      });
const staffViewer = {
  githubUserId: "99101",
  role: "staff",
  authorizedAssignmentIds: assignments.map(({ assignmentId }) => assignmentId),
  blindAssignmentIds: [],
  acceptedAttemptOneAssignmentIds: [assignment.assignmentId],
};

function projectAssignment(source) {
  const view = buildStaffAssignmentView(staffViewer, source.assignmentId, assignments);
  if (!view.allowed) throw new Error(`Fixture assignment ${source.assignmentId} is unavailable`);
  return view.assignment;
}

async function dashboardSnapshot() {
  if (liveDashboard !== undefined) return liveDashboard.loadDashboard();
  const operations = await store.read();
  return {
    adapterVersion: "staff-dashboard-v1",
    environment: { kind: "local-fixture", label: "LOCAL FIXTURE" },
    revision: operations.revision,
    cases,
    assignments: [
      {
        assignment: projectAssignment(assignment),
        reviewRequest,
        submission,
        acceptedSubmission,
        originalProviderRecord,
        replayProviderRecord,
        providerRecordReceipts,
        artifacts,
        artifactReceipts,
        releasedEvidence,
      },
      {
        assignment: projectAssignment(provisioningAssignment),
        blocked: {
          title: "Repository access is not ready",
          detail:
            "The assignment remains blocked until repository and collaborator access are both read back from the provider. No review, evidence, or evaluation is available yet.",
        },
      },
    ],
    operations: {
      reviewResponses: operations.reviewResponses,
      evaluations: operations.evaluations,
      replays: operations.replays,
      reopens: operations.reopens,
      history: operations.operationHistory,
    },
  };
}

function json(response, status, payload) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1_000_000) throw new Error("Staff dashboard request is too large");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Staff dashboard request must be a JSON object");
  }
  return value;
}

function assertPrimaryAssignment(assignmentId) {
  if (assignmentId !== assignment.assignmentId) {
    throw new Error("This staff operation is not available for the selected assignment");
  }
}

async function recordMutation(kind, input) {
  if (liveDashboard !== undefined) {
    if (kind === "review-response") return liveDashboard.recordReviewResponse(input);
    if (kind === "evaluation") return liveDashboard.recordEvaluation(input);
    if (kind === "replay") return liveDashboard.createReplay(input);
    return liveDashboard.reopenAttempt(input);
  }
  const assignmentId = input.assignmentId;
  const operationId = input.operationId;
  assertPrimaryAssignment(assignmentId);
  const current = await store.read();
  const existingCollection =
    kind === "review-response"
      ? current.reviewResponses
      : kind === "evaluation"
        ? current.evaluations
        : kind === "replay"
          ? current.replays
          : current.reopens;
  const existing = existingCollection[assignmentId];
  if (existing?.operationId === operationId) return dashboardSnapshot();

  if (kind === "review-response") {
    const response = createReviewResponse(
      reviewRequest,
      {
        reviewResponseId: operationId,
        operationId,
        assignmentId,
        attemptNumber: assignment.attemptNumber,
        responderGithubUserId: "99101",
        responseText: input.responseText,
        respondedAt: new Date().toISOString(),
      },
      Object.values(current.reviewResponses),
    );
    await store.recordReviewResponse(assignmentId, response);
    return dashboardSnapshot();
  }

  if (kind === "evaluation") {
    const evaluation = createHumanEvaluation({
      evaluationId: operationId,
      operationId,
      evaluatorGithubUserId: "99101",
      evaluatedAt: new Date().toISOString(),
      acceptedSubmission,
      draft: input.draft,
    });
    await store.recordEvaluation(assignmentId, evaluation);
    return dashboardSnapshot();
  }

  const evaluation = current.evaluations[assignmentId];
  if (evaluation === undefined) {
    throw new Error("Record the human evaluation before replaying or reopening this attempt");
  }
  if (kind === "replay") {
    const comparison = buildReplayComparison(
      originalProviderRecord,
      replayProviderRecord,
      evaluation,
      providerRecordReceipts,
    );
    await store.recordReplay(assignmentId, { operationId, comparison });
    return dashboardSnapshot();
  }

  const result = reopenEvaluatedAttempt(
    {
      assignmentId,
      caseVersionDigest: assignment.caseVersionDigest,
      attemptNumber: assignment.attemptNumber,
      status: "submitted",
      submissionId: submission.submissionId,
      submissionDigest: submission.submissionDigest,
      evaluation,
    },
    { operationId, openedAt: new Date().toISOString() },
  );
  await store.recordReopen(assignmentId, { operationId, result });
  return dashboardSnapshot();
}

async function serveStatic(requestUrl, response) {
  const servesCoreEvaluation = requestUrl.pathname === "/core/dist/evaluation.js";
  const relativePath = requestUrl.pathname === "/" ? "web/index.html" : requestUrl.pathname.slice(1);
  const filePath = servesCoreEvaluation
    ? resolve(coreRoot, "dist/evaluation.js")
    : resolve(packageRoot, relativePath);
  const allowedRoot = servesCoreEvaluation ? coreRoot : packageRoot;
  if (!filePath.startsWith(`${allowedRoot}${sep}`)) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    if (!(await stat(filePath)).isFile()) throw new Error("Not a file");
  } catch {
    response.writeHead(404).end("Not found");
    return;
  }
  response.setHeader("Content-Type", mimeTypes.get(extname(filePath)) ?? "application/octet-stream");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'sha256-7IVWcB/xk2bhXot3x8tK5WX0y6U2Z+F/wxr/eFBK/EA='; style-src 'self'; img-src 'none'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'",
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && requestUrl.pathname === "/api/staff-dashboard") {
      json(response, 200, await dashboardSnapshot());
      return;
    }
    const mutation = mutationRoutes.get(requestUrl.pathname);
    if (request.method === "POST" && mutation !== undefined) {
      json(response, 200, await recordMutation(mutation, await readJson(request)));
      return;
    }
    if (requestUrl.pathname.startsWith("/api/")) {
      json(response, 404, { error: "Staff dashboard endpoint not found" });
      return;
    }
    await serveStatic(requestUrl, response);
  } catch (error) {
    json(response, 400, {
      error: error instanceof Error ? error.message : "Staff dashboard request failed",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  const mode = liveDashboard === undefined ? "fixture" : "connected local student state";
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Staff workbench did not bind to loopback");
  }
  process.stdout.write(
    `Staff workbench ${mode}: http://127.0.0.1:${address.port} (store: ${storeFile})\n`,
  );
});

function stopServer() {
  server.close(() => {
    process.exitCode = 0;
  });
}

process.once("SIGINT", stopServer);
process.once("SIGTERM", stopServer);
