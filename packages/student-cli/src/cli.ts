import { SubmissionDraftSchema } from "@volta-sim/contracts";
import { z } from "zod";

import { HttpStudentServiceClient } from "./http-client.js";
import {
  DEFAULT_COMMAND_NAME,
  loginNextSteps,
  missingOperationIdMessage,
  missingSessionMessage,
  readinessNextSteps,
  studentGuideMarkdown,
  submittedNextSteps,
} from "./guide.js";
import { commandHelp, globalHelp } from "./help.js";
import {
  readPendingSubmission,
  removePendingSubmission,
  writePendingSubmission,
} from "./pending-submission.js";
import {
  captureSubmissionArtifacts,
  deriveAssignmentRepositoryRoot,
  GitCliRepositoryVerifier,
} from "./repository.js";
import {
  readStudentSession,
  removeStudentSession,
  writeStudentSession,
} from "./session.js";
import type {
  StudentServiceClient,
  StudentServiceRequest,
  StudentServiceResponse,
} from "./types.js";

export const TRUSTED_SERVICE_ORIGIN = "https://student-service.invalid";
export const FIXED_SESSION_PATH = ".volta-sim/session.json";

const REPEATED_FLAGS = new Set([
  "artifact",
  "assumption",
  "evidence-id",
  "fact-id",
  "expected-evidence",
  "pivot-condition",
  "input",
  "input-name",
  "risk",
]);
const REPEATED_LIMITS: Readonly<Record<string, number>> = {
  artifact: 50,
  assumption: 50,
  "evidence-id": 100,
  "fact-id": 100,
  "expected-evidence": 30,
  "pivot-condition": 30,
  input: 30,
  "input-name": 30,
  risk: 50,
};

const COMMAND_FLAGS: Record<string, ReadonlySet<string>> = {
  login: new Set(["operation-id"]),
  resume: new Set(),
  status: new Set(),
  talk: new Set(["operation-id", "persona", "question"]),
  evidence: new Set(["operation-id", "source", "question"]),
  request: new Set(["operation-id", "source", "question"]),
  collect: new Set(["operation-id", "method", "plan"]),
  advance: new Set(["operation-id", "days", "reason"]),
  ledger: new Set(["operation-id", "kind", "statement", "fact-id"]),
  decision: new Set([
    "operation-id",
    "choice",
    "rationale",
    "evidence-id",
    "expected-evidence",
    "pivot-condition",
  ]),
  estimate: new Set([
    "operation-id",
    "subject",
    "low",
    "high",
    "unit",
    "assumption",
    "confidence",
  ]),
  requirement: new Set([
    "operation-id",
    "id",
    "status",
    "rationale",
    "evidence-id",
  ]),
  claim: new Set(["operation-id", "competency", "rationale", "evidence-id"]),
  draft: new Set([
    "operation-id",
    "mode",
    "rationale",
    "feasibility",
    "risk",
    "missing-data-plan",
    "economic-rationale",
  ]),
  criterion: new Set([
    "operation-id",
    "metric",
    "baseline",
    "baseline-plan",
    "target",
    "target-date",
    "failure-threshold",
  ]),
  "criterion-remove": new Set(["operation-id", "id"]),
  "calculation-remove": new Set(["operation-id", "id"]),
  calculation: new Set([
    "operation-id",
    "name",
    "input",
    "operation",
    "input-name",
    "result",
    "result-unit",
    "rationale",
  ]),
  checkpoint: new Set(),
  "review-request": new Set(["operation-id", "topic", "choice"]),
  submit: new Set(["operation-id", "artifact"]),
  logout: new Set(["operation-id"]),
};

interface ParsedArguments {
  readonly command: string;
  readonly flags: ReadonlyMap<string, readonly string[]>;
}

function requestedHelp(argv: readonly string[]): string | undefined {
  if (argv.length === 0 || (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0]!))) {
    return globalHelp();
  }
  if (argv[0] === "help") {
    if (argv.length !== 2) throw new Error("Use volta-sim help <command>");
    const help = commandHelp(argv[1]!);
    if (help === undefined) throw new Error(`Unknown command ${argv[1]}. Run volta-sim --help`);
    return help;
  }
  if (argv.length === 2 && (argv[1] === "--help" || argv[1] === "-h")) {
    const help = commandHelp(argv[0]!);
    if (help === undefined) throw new Error(`Unknown command ${argv[0]}. Run volta-sim --help`);
    return help;
  }
  return undefined;
}

export interface CliIo {
  writeOut(value: string): void;
  writeError(value: string): void;
}

export interface RunCliOptions {
  readonly client?: StudentServiceClient;
  readonly assignmentRoot?: string;
  readonly io?: CliIo;
  /** The exact text a student types before a command, used in guidance messages. */
  readonly commandName?: string;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.length > 500) throw new Error("Too many command options were provided");
  const command = argv[0];
  if (command === undefined || !(command in COMMAND_FLAGS)) {
    throw new Error("Choose a supported command. Run with --help for usage");
  }
  const allowed = COMMAND_FLAGS[command]!;
  const flags = new Map<string, string[]>();
  for (let index = 1; index < argv.length; index += 2) {
    const rawName = argv[index];
    const value = argv[index + 1];
    if (
      rawName === undefined ||
      !rawName.startsWith("--") ||
      value === undefined ||
      value.startsWith("--") ||
      rawName.length > 82 ||
      value.length > 10_000
    ) {
      throw new Error("Every option must use --name followed by one value");
    }
    const name = rawName.slice(2);
    if (!allowed.has(name)) throw new Error(`The --${name} option is not available for ${command}`);
    if (!REPEATED_FLAGS.has(name) && flags.has(name)) {
      throw new Error(`The --${name} option may be supplied only once`);
    }
    const values = [...(flags.get(name) ?? []), value];
    if (values.length > (REPEATED_LIMITS[name] ?? 1)) {
      throw new Error(`Too many --${name} values were provided`);
    }
    flags.set(name, values);
  }
  return { command, flags };
}

function parsedOperationId(
  flags: ReadonlyMap<string, readonly string[]>,
  command = "this command",
  commandName = DEFAULT_COMMAND_NAME,
): string {
  if (flags.get("operation-id")?.[0] === undefined) {
    throw new Error(missingOperationIdMessage(command, commandName));
  }
  const value = required(flags, "operation-id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error("Provide an operation id of at most 160 safe characters");
  }
  return value;
}

function optional(flags: ReadonlyMap<string, readonly string[]>, name: string): string | undefined {
  const value = flags.get(name)?.[0];
  if (value === undefined) return undefined;
  if (value.trim() === "" || value.length > 10_000) {
    throw new Error(`Provide --${name} with your own value`);
  }
  return value;
}

function required(flags: ReadonlyMap<string, readonly string[]>, name: string): string {
  const value = flags.get(name)?.[0];
  if (value === undefined || value.trim() === "" || value.length > 10_000) {
    throw new Error(`Provide --${name} with your own value`);
  }
  return value;
}

function repeated(flags: ReadonlyMap<string, readonly string[]>, name: string): readonly string[] {
  return flags.get(name) ?? [];
}

function numberValue(
  flags: ReadonlyMap<string, readonly string[]>,
  name: string,
  options: { readonly integer?: boolean; readonly min?: number; readonly max?: number } = {},
): number {
  const value = Number(required(flags, name));
  if (
    !Number.isFinite(value) ||
    (options.integer === true && !Number.isInteger(value)) ||
    (options.min !== undefined && value < options.min) ||
    (options.max !== undefined && value > options.max)
  ) {
    throw new Error(`Provide a valid --${name} value`);
  }
  return value;
}

function oneOf<const T extends string>(
  flags: ReadonlyMap<string, readonly string[]>,
  name: string,
  values: readonly T[],
): T {
  const value = required(flags, name);
  if (!values.includes(value as T)) {
    throw new Error(`Provide --${name} as one of: ${values.join(" | ")}`);
  }
  return value as T;
}

const OffsetDateTimeSchema = z.string().datetime({ offset: true });

function normalizedTargetDate(flags: ReadonlyMap<string, readonly string[]>): string {
  const value = required(flags, "target-date");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const normalized = `${value}T00:00:00.000Z`;
    const parsed = new Date(normalized);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString() === normalized) return normalized;
  } else if (OffsetDateTimeSchema.safeParse(value).success) {
    return new Date(value).toISOString();
  }
  throw new Error(
    "Provide --target-date as YYYY-MM-DD (for example 2026-10-31) or an ISO 8601 datetime with an offset",
  );
}

function actionRequest(parsed: ParsedArguments, commandName: string): StudentServiceRequest {
  const flags = parsed.flags;
  const operationId = parsedOperationId(flags, parsed.command, commandName);
  switch (parsed.command) {
    case "talk":
      return {
        kind: "talk",
        operationId,
        personaId: required(flags, "persona"),
        question: required(flags, "question"),
      };
    case "evidence":
    case "request":
      return {
        kind: "evidence",
        operationId,
        evidenceSourceId: required(flags, "source"),
        question: required(flags, "question"),
      };
    case "collect":
      return {
        kind: "collect",
        operationId,
        methodId: required(flags, "method"),
        plan: required(flags, "plan"),
      };
    case "advance":
      return {
        kind: "advance",
        operationId,
        days: numberValue(flags, "days", { integer: true, min: 1, max: 3650 }),
        reason: required(flags, "reason"),
      };
    case "ledger": {
      const kind = oneOf(flags, "kind", ["fact", "assumption", "contradiction", "unknown"]);
      return {
        kind: "ledger",
        operationId,
        entry: {
          kind,
          statement: required(flags, "statement"),
          officialFactIds: [...repeated(flags, "fact-id")],
        },
      };
    }
    case "decision":
      return {
        kind: "decision",
        operationId,
        decision: {
          choice: oneOf(flags, "choice", [
            "continue",
            "pivot",
            "buy",
            "collect-more-evidence",
            "stop",
          ]),
          rationale: required(flags, "rationale"),
          supportingEvidenceIds: [...repeated(flags, "evidence-id")],
          expectedEvidence: repeated(flags, "expected-evidence").map((value) => {
            const parts = value.split("|");
            if (parts.length !== 3 || parts.some((part) => part.trim() === "")) {
              throw new Error(
                "Each --expected-evidence must use description|source-or-method|decision-use",
              );
            }
            return {
              description: parts[0]!,
              sourceOrMethod: parts[1]!,
              decisionUse: parts[2]!,
            };
          }),
          pivotOrStopConditions: repeated(flags, "pivot-condition").map((value) => {
            const parts = value.split("|");
            if (
              parts.length !== 3 ||
              (parts[0] !== "pivot" && parts[0] !== "stop") ||
              parts.slice(1).some((part) => part.trim() === "")
            ) {
              throw new Error("Each --pivot-condition must use pivot-or-stop|condition|rationale");
            }
            return { action: parts[0], condition: parts[1]!, rationale: parts[2]! };
          }),
        },
      };
    case "estimate":
      return {
        kind: "estimate",
        operationId,
        estimate: {
          subject: required(flags, "subject"),
          low: numberValue(flags, "low", { min: 0 }),
          high: numberValue(flags, "high", { min: 0 }),
          unit: required(flags, "unit"),
          assumptions: [...repeated(flags, "assumption")],
          confidence: numberValue(flags, "confidence", { min: 0, max: 1 }),
        },
      };
    case "requirement":
      return {
        kind: "requirement",
        operationId,
        requirementId: required(flags, "id"),
        status: oneOf(flags, "status", ["addressed", "not-yet", "not-applicable"]),
        rationale: required(flags, "rationale"),
        evidenceIds: repeated(flags, "evidence-id"),
      };
    case "claim":
      return {
        kind: "claim",
        operationId,
        competencyId: oneOf(flags, "competency", [
          "problem-viability",
          "evidence-sufficiency",
          "response-feasibility",
          "objective-success-criteria",
        ]),
        rationale: required(flags, "rationale"),
        evidenceIds: repeated(flags, "evidence-id"),
      };
    case "draft":
      return {
        kind: "draft",
        operationId,
        mode: oneOf(flags, "mode", ["build", "pilot", "buy", "no-build", "data-collection"]),
        rationale: required(flags, "rationale"),
        feasibility: required(flags, "feasibility"),
        risks: repeated(flags, "risk"),
        missingDataPlan: required(flags, "missing-data-plan"),
        economicRationale: required(flags, "economic-rationale"),
      };
    case "criterion": {
      const baseline = optional(flags, "baseline");
      const baselinePlan = optional(flags, "baseline-plan");
      if ((baseline === undefined) === (baselinePlan === undefined)) {
        throw new Error("Provide exactly one of --baseline or --baseline-plan");
      }
      return {
        kind: "criterion",
        operationId,
        criterion: {
          metric: required(flags, "metric"),
          ...(baseline === undefined ? {} : { baseline }),
          ...(baselinePlan === undefined ? {} : { baselinePlan }),
          target: required(flags, "target"),
          targetDate: normalizedTargetDate(flags),
          failureThreshold: required(flags, "failure-threshold"),
        },
      };
    }
    case "criterion-remove":
      return {
        kind: "criterion-remove",
        operationId,
        criterionId: required(flags, "id"),
      };
    case "calculation": {
      const inputs = repeated(flags, "input").map((input) => {
        const parts = input.split("|");
        if (parts.length !== 4 || parts.some((part) => part.trim() === "")) {
          throw new Error("Each --input must use name|value|unit|source");
        }
        const value = Number(parts[1]);
        if (!Number.isFinite(value)) throw new Error("Each calculation input needs a numeric value");
        return { name: parts[0]!, value, unit: parts[2]!, source: parts[3]! };
      });
      return {
        kind: "calculation",
        operationId,
        calculation: {
          name: required(flags, "name"),
          inputs,
          formula: {
            operation: oneOf(flags, "operation", [
              "sum",
              "difference",
              "product",
              "quotient",
              "percentage-change",
            ]),
            inputNames: [...repeated(flags, "input-name")],
          },
          result: {
            value: numberValue(flags, "result"),
            unit: required(flags, "result-unit"),
          },
          rationale: required(flags, "rationale"),
        },
      };
    }
    case "review-request":
      return {
        kind: "review-request",
        operationId,
        topic: required(flags, "topic"),
        studentChoice: oneOf(flags, "choice", ["continue", "wait", "decline"]),
      };
    case "calculation-remove":
      return {
        kind: "calculation-remove",
        operationId,
        calculationId: required(flags, "id"),
      };
    case "logout":
      return { kind: "logout", operationId };
    default:
      throw new Error("Choose a supported action");
  }
}

function printResponse(
  response: StudentServiceResponse,
  io: CliIo,
  commandName = DEFAULT_COMMAND_NAME,
): void {
  if (response.kind === "login") {
    io.writeOut(`Signed in for assignment ${response.assignmentId}. The token was saved locally.`);
    for (const line of loginNextSteps(commandName)) io.writeOut(line);
    return;
  }
  if (response.kind === "view") {
    const nextSteps =
      response.view.attemptStatus === "submitted"
        ? submittedNextSteps(response.view.attemptNumber, commandName)
        : readinessNextSteps({
      missing: response.view.readiness.missing,
      requirements: response.view.readiness.requirements,
            artifactRequirement: response.view.artifactRequirement,
            commandName,
          });
    io.writeOut(JSON.stringify({ ...response, nextSteps }, null, 2));
    return;
  }
  if (response.kind === "preparation") {
    const nextSteps = readinessNextSteps({
      missing: response.baseReport.missing,
      requirements: response.baseReport.requirements,
      artifactRequirement: response.artifactRequirement,
      commandName,
    });
    io.writeOut(JSON.stringify({ ...response, nextSteps }, null, 2));
    return;
  }
  io.writeOut(JSON.stringify(response, null, 2));
}

export async function runCli(argv: readonly string[], options: RunCliOptions = {}): Promise<number> {
  const io =
    options.io ??
    ({
      writeOut: (value: string) => process.stdout.write(`${value}\n`),
      writeError: (value: string) => process.stderr.write(`${value}\n`),
    } satisfies CliIo);
  const commandName = options.commandName ?? DEFAULT_COMMAND_NAME;
  try {
    const help = requestedHelp(argv);
    if (help !== undefined) {
      io.writeOut(help);
      return 0;
    }
    if (argv.length === 1 && argv[0] === "guide") {
      io.writeOut(studentGuideMarkdown({ commandName }));
      return 0;
    }
    const parsed = parseArguments(argv);
    const assignmentRoot =
      options.assignmentRoot ?? (await deriveAssignmentRepositoryRoot(process.cwd()));
    const client =
      options.client ?? new HttpStudentServiceClient(TRUSTED_SERVICE_ORIGIN);

    if (parsed.command === "login") {
      const response = await client.execute({
        kind: "login",
        operationId: parsedOperationId(parsed.flags, "login", commandName),
      });
      if (response.kind !== "login") throw new Error("The service did not complete sign-in");
      await new GitCliRepositoryVerifier({
        repositorySlug: response.repository.slug,
        commitSha: response.repository.commitSha,
        sessionIgnoreBlobId: response.repository.sessionIgnoreBlobId,
      }).verify(assignmentRoot, []);
      await writeStudentSession(assignmentRoot, FIXED_SESSION_PATH, {
        version: 1,
        assignmentId: response.assignmentId,
        token: response.token,
        repository: response.repository,
      });
      printResponse(response, io, commandName);
      return 0;
    }

    const session = await readStudentSession(assignmentRoot, FIXED_SESSION_PATH).catch(() => {
      throw new Error(missingSessionMessage(commandName));
    });
    await new GitCliRepositoryVerifier({
      repositorySlug: session.repository.slug,
      commitSha: session.repository.commitSha,
      sessionIgnoreBlobId: session.repository.sessionIgnoreBlobId,
    }).verify(assignmentRoot, []);
    if (parsed.command === "resume" || parsed.command === "status") {
      printResponse(await client.execute({ kind: parsed.command }, session.token), io, commandName);
      return 0;
    }
    if (parsed.command === "checkpoint") {
      printResponse(await client.execute({ kind: "checkpoint" }, session.token), io);
      return 0;
    }
    if (parsed.command === "submit") {
      const submitOperationId = parsedOperationId(parsed.flags, "submit", commandName);
      const pending = await readPendingSubmission(assignmentRoot);
      if (pending !== undefined) {
        if (pending.operationId !== submitOperationId) {
          throw new Error(
            `Submission ${pending.operationId} is awaiting reconciliation. Retry that operation id first`,
          );
        }
        const replay = await client.execute(pending, session.token);
        if (replay.kind !== "submission") {
          throw new Error("The service did not reconcile the pending submission");
        }
        printResponse(replay, io);
        await removePendingSubmission(assignmentRoot);
        return replay.accepted ? 0 : 1;
      }
      const status = await client.execute({ kind: "status" }, session.token);
      if (status.kind !== "view" || status.view.assignmentId !== session.assignmentId) {
        throw new Error("The active session does not match this assignment. Sign in again");
      }
      const preparation = await client.execute({ kind: "prepare-submission" }, session.token);
      if (preparation.kind !== "preparation") {
        throw new Error("The service could not prepare this submission. Run status, then retry");
      }
      const selectedPaths = repeated(parsed.flags, "artifact");
      if (
        !preparation.baseReady ||
        preparation.submissionBase === undefined ||
        preparation.requestedMode === undefined
      ) {
        printResponse(preparation, io, commandName);
        return 1;
      }
      const submissionBase = preparation.submissionBase;
      const requestedMode = preparation.requestedMode;
      if (preparation.artifactRequirement.required && selectedPaths.length === 0) {
        io.writeError(
          "A build or pilot response requires at least one tracked artifact. Add --artifact <path>, then retry.",
        );
        return 1;
      }
      if (requestedMode === "no-build" && selectedPaths.length !== 0) {
        throw new Error("A no-build response cannot include an artifact. Remove every --artifact value");
      }
      const captured = await captureSubmissionArtifacts(
        assignmentRoot,
        selectedPaths,
        new GitCliRepositoryVerifier({
          repositorySlug: status.view.repository.slug,
          commitSha: status.view.repository.commitSha,
          sessionIgnoreBlobId: status.view.repository.sessionIgnoreBlobId,
        }),
      );
      const draft = SubmissionDraftSchema.parse({
        ...submissionBase,
        gitCommitSha: captured.repository.commitSha,
        responsePlan: {
          ...submissionBase.responsePlan,
          mode: requestedMode,
          artifactSnapshots: captured.artifacts,
        },
      });
      const request = {
        kind: "submit" as const,
        operationId: submitOperationId,
        draft,
        artifacts: captured.artifacts,
        repository: captured.repository,
        mode: requestedMode,
      };
      await writePendingSubmission(assignmentRoot, request);
      const response = await client.execute(request, session.token);
      if (response.kind !== "submission") {
        throw new Error("The service did not return a submission result");
      }
      printResponse(response, io);
      await removePendingSubmission(assignmentRoot);
      return response.accepted ? 0 : 1;
    }

    const response = await client.execute(actionRequest(parsed, commandName), session.token);
    if (parsed.command === "logout") {
      await removeStudentSession(assignmentRoot, FIXED_SESSION_PATH);
    }
    printResponse(response, io);
    return 0;
  } catch (error) {
    io.writeError(error instanceof Error ? error.message : "The command could not be completed");
    return 1;
  }
}
