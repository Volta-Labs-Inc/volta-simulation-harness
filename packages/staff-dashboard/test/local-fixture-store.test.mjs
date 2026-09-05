import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalFixtureStore } from "../scripts/local-fixture-store.mjs";

describe("local durable staff fixture store", () => {
  it.each([1, 2])("preserves version %i review history while appending another request in the same attempt", async (schemaVersion) => {
    const directory = await mkdtemp(join(tmpdir(), "volta-staff-migration-"));
    const filePath = join(directory, "staff-dashboard.json");
    const original = { operationId: "response-one", attemptNumber: 1, reviewRequestId: "question-one", responseText: "First guidance" };
    await writeFile(filePath, JSON.stringify({ schemaVersion, revision: 1, reviewResponses: { "assignment-a": schemaVersion === 1 ? original : [original] }, evaluations: {}, reopens: {}, replays: {} }));
    const store = createLocalFixtureStore({ filePath, assignmentIds: ["assignment-a"] });
    const second = { operationId: "response-two", attemptNumber: 1, reviewRequestId: "question-two", responseText: "Second guidance" };
    await store.recordReviewResponse("assignment-a", second);
    await store.recordReviewResponse("assignment-a", second);
    await expect(store.recordReviewResponse("assignment-a", { ...second, operationId: "response-replacement" })).rejects.toThrow(/append-only/);
    await expect(store.recordReviewResponse("assignment-a", { ...second, responseText: "Changed guidance" })).rejects.toThrow(/append-only/);
    await expect(store.recordReviewResponse("assignment-a", { ...second, operationId: original.operationId })).rejects.toThrow(/cannot be reused/);
    const reloaded = await createLocalFixtureStore({ filePath, assignmentIds: ["assignment-a"] }).read();
    expect(reloaded.operationHistory.reviewResponses["assignment-a"]).toEqual([original, second]);
    expect(reloaded.revision).toBe(2);
  });
  it("preserves staff responses, evaluations, and replays across store instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "volta-staff-store-"));
    const filePath = join(directory, "staff-dashboard.json");
    const first = createLocalFixtureStore({
      filePath,
      assignmentIds: ["assignment-a", "assignment-b"],
    });

    await first.recordReviewResponse("assignment-a", {
      operationId: "review-response-1",
      responseText: "Keep the comparison offline.",
    });
    await first.recordEvaluation("assignment-a", {
      operationId: "evaluation-1",
      overallRating: "partially-effective",
    });
    await first.recordReplay("assignment-a", {
      operationId: "replay-1",
      replayOfInteractionId: "interaction-original",
    });

    const afterReload = await createLocalFixtureStore({
      filePath,
      assignmentIds: ["assignment-a", "assignment-b"],
    }).read();

    expect(afterReload.revision).toBe(3);
    expect(afterReload.reviewResponses["assignment-a"].responseText).toBe(
      "Keep the comparison offline.",
    );
    expect(afterReload.evaluations["assignment-a"].overallRating).toBe(
      "partially-effective",
    );
    expect(afterReload.replays["assignment-a"].replayOfInteractionId).toBe(
      "interaction-original",
    );
  });

  it("is idempotent by operation id and rejects assignments outside the adapter snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "volta-staff-store-"));
    const filePath = join(directory, "staff-dashboard.json");
    const store = createLocalFixtureStore({ filePath, assignmentIds: ["assignment-a"] });
    const record = {
      operationId: "review-response-1",
      responseText: "Keep the comparison offline.",
    };

    await store.recordReviewResponse("assignment-a", record);
    await store.recordReviewResponse("assignment-a", record);

    expect((await store.read()).revision).toBe(1);
    await expect(store.recordEvaluation("assignment-unknown", record)).rejects.toThrow(
      /unknown assignment/u,
    );
  });
});
