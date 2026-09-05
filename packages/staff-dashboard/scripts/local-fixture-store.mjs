import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

const STORE_SCHEMA_VERSION = 2;
const operationIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const attemptScopedCollections = new Set(["reviewResponses", "evaluations", "reopens"]);

function emptyState() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    revision: 0,
    reviewResponses: {},
    evaluations: {},
    replays: {},
    reopens: {},
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertRecord(record) {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    throw new Error("Staff operation must be a JSON object");
  }
  if (
    typeof record.operationId !== "string" ||
    !operationIdPattern.test(record.operationId)
  ) {
    throw new Error("Staff operation requires a safe operation id");
  }
}

function assertState(state) {
  if (
    typeof state !== "object" ||
    state === null ||
    Array.isArray(state) ||
    state.schemaVersion !== STORE_SCHEMA_VERSION ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0
  ) {
    throw new Error("Local staff fixture store is invalid");
  }
  for (const field of ["reviewResponses", "evaluations", "replays", "reopens"]) {
    const value = state[field];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Local staff fixture store has an invalid ${field} collection`);
    }
    for (const recordOrRecords of Object.values(value)) {
      if (attemptScopedCollections.has(field)) {
        if (!Array.isArray(recordOrRecords)) {
          throw new Error(`Local staff fixture store has an invalid ${field} history`);
        }
        for (const record of recordOrRecords) assertRecord(record);
      } else {
        assertRecord(recordOrRecords);
      }
    }
  }
}

function migrateLegacyState(state) {
  if (
    typeof state !== "object" ||
    state === null ||
    Array.isArray(state) ||
    state.schemaVersion !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0
  ) {
    throw new Error("Local staff fixture store is invalid");
  }
  const migrated = emptyState();
  migrated.revision = state.revision;
  for (const field of ["reviewResponses", "evaluations", "reopens"]) {
    const collection = state[field];
    if (typeof collection !== "object" || collection === null || Array.isArray(collection)) {
      throw new Error(`Local staff fixture store has an invalid ${field} collection`);
    }
    for (const [assignmentId, record] of Object.entries(collection)) {
      assertRecord(record);
      migrated[field][assignmentId] = [clone(record)];
    }
  }
  if (typeof state.replays !== "object" || state.replays === null || Array.isArray(state.replays)) {
    throw new Error("Local staff fixture store has an invalid replays collection");
  }
  for (const [assignmentId, record] of Object.entries(state.replays)) {
    assertRecord(record);
    migrated.replays[assignmentId] = clone(record);
  }
  return migrated;
}

async function readState(filePath) {
  try {
    const state = JSON.parse(await readFile(filePath, "utf8"));
    if (state?.schemaVersion === 1) return migrateLegacyState(state);
    assertState(state);
    return state;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

export function createLocalFixtureStore({ filePath, assignmentIds }) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Local staff fixture store requires a file path");
  }
  const allowedAssignmentIds = new Set(assignmentIds);
  let pendingWrite = Promise.resolve();

  function assertAssignment(assignmentId) {
    if (!allowedAssignmentIds.has(assignmentId)) {
      throw new Error(`Cannot record staff operation for unknown assignment ${assignmentId}`);
    }
  }

  async function read() {
    await pendingWrite;
    const state = await readState(filePath);
    const latest = (collection) =>
      Object.fromEntries(
        Object.entries(collection).flatMap(([assignmentId, records]) =>
          records.length === 0 ? [] : [[assignmentId, clone(records.at(-1))]],
        ),
      );
    return {
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      reviewResponses: latest(state.reviewResponses),
      evaluations: latest(state.evaluations),
      replays: clone(state.replays),
      reopens: latest(state.reopens),
      operationHistory: {
        reviewResponses: clone(state.reviewResponses),
        evaluations: clone(state.evaluations),
        reopens: clone(state.reopens),
      },
    };
  }

  function attemptNumber(collection, recordValue) {
    const direct = recordValue.attemptNumber;
    if (Number.isSafeInteger(direct) && direct > 0) return direct;
    const previous = collection === "reopens" ? recordValue.result?.previous?.attemptNumber : undefined;
    return Number.isSafeInteger(previous) && previous > 0 ? previous : "legacy";
  }

  function recordAttemptScoped(collection, assignmentId, recordValue) {
    const operation = async () => {
      assertAssignment(assignmentId);
      assertRecord(recordValue);
      const state = await readState(filePath);
      const records = state[collection][assignmentId] ?? [];
      const scope = attemptNumber(collection, recordValue);
      const sameScope = records.find(
        (record) => attemptNumber(collection, record) === scope &&
          (collection !== "reviewResponses" ||
            (record.reviewRequestId ?? "legacy") === (recordValue.reviewRequestId ?? "legacy")),
      );
      const reusedOperation = records.find(
        (record) => record.operationId === recordValue.operationId,
      );
      if (
        reusedOperation !== undefined &&
        (attemptNumber(collection, reusedOperation) !== scope ||
          (collection === "reviewResponses" && reusedOperation.reviewRequestId !== recordValue.reviewRequestId))
      ) {
        throw new Error(
          `Operation ${recordValue.operationId} cannot be reused across attempts or requests for assignment ${assignmentId}`,
        );
      }
      if (sameScope !== undefined) {
        if (
          sameScope.operationId === recordValue.operationId &&
          JSON.stringify(sameScope) === JSON.stringify(recordValue)
        ) {
          return clone(sameScope);
        }
        throw new Error(
          `${collection} is append-only for assignment ${assignmentId} attempt ${scope}`,
        );
      }
      state[collection][assignmentId] = [...records, clone(recordValue)];
      state.revision += 1;
      await writeState(filePath, state);
      return clone(recordValue);
    };
    const result = pendingWrite.then(operation, operation);
    pendingWrite = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function recordReplay(assignmentId, recordValue) {
    const operation = async () => {
      assertAssignment(assignmentId);
      assertRecord(recordValue);
      const state = await readState(filePath);
      const existing = state.replays[assignmentId];
      if (existing !== undefined) {
        if (
          existing.operationId === recordValue.operationId &&
          JSON.stringify(existing) === JSON.stringify(recordValue)
        ) {
          return clone(existing);
        }
        throw new Error(`replays is append-only for assignment ${assignmentId}`);
      }
      state.replays[assignmentId] = clone(recordValue);
      state.revision += 1;
      await writeState(filePath, state);
      return clone(recordValue);
    };
    const result = pendingWrite.then(operation, operation);
    pendingWrite = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    read,
    recordReviewResponse: (assignmentId, recordValue) =>
      recordAttemptScoped("reviewResponses", assignmentId, recordValue),
    recordEvaluation: (assignmentId, recordValue) =>
      recordAttemptScoped("evaluations", assignmentId, recordValue),
    recordReplay,
    recordReopen: (assignmentId, recordValue) =>
      recordAttemptScoped("reopens", assignmentId, recordValue),
  };
}
