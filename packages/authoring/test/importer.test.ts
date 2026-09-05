import { cp, mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CaseVersionSourceSchema } from "@volta-sim/contracts";
import { resolveAuthoredRequest } from "@volta-sim/core";
import { describe, expect, it } from "vitest";
import { sha256Digest } from "../../core/src/canonical.js";
import { createCaseVersionDigests } from "../../core/src/case-version.js";
import { publishCase } from "../../core/src/published-case.js";
import { parseCsv } from "../src/assembly.js";
import { createCaseValidationPreview, importCaseDirectory } from "../src/importer.js";

const fixtureRoot = path.resolve(
  import.meta.dirname,
  "fixtures/non-assessed-bicycle-library",
);

async function copyFixture(): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "volta-authoring-test-"));
  const caseRoot = path.join(temporaryRoot, "case");
  await cp(fixtureRoot, caseRoot, { recursive: true });
  return caseRoot;
}

async function replaceAssembly(caseRoot: string, from: string, to: string): Promise<void> {
  const assemblyPath = path.join(caseRoot, "staff/assembly.yaml");
  const current = await readFile(assemblyPath, "utf8");
  if (!current.includes(from)) throw new Error(`Fixture replacement did not match: ${from}`);
  await writeFile(assemblyPath, current.replace(from, to), "utf8");
}

async function approveCaseFixture(caseRoot: string): Promise<void> {
  const draft = await importCaseDirectory(caseRoot);
  const casePath = path.join(caseRoot, "case.yaml");
  const current = await readFile(casePath, "utf8");
  await writeFile(
    casePath,
    current
      .replace("status: draft", "status: approved")
      .replace("visible_bundle_sha256: pending-publication", `visible_bundle_sha256: ${draft.digests.visibleBundleDigest}`)
      .replace("protected_package_sha256: pending-publication", `protected_package_sha256: ${draft.digests.protectedPackageDigest}`)
      .replace("approved_by: null", "approved_by: Public fixture reviewer")
      .replace("approved_at: null", 'approved_at: "2026-09-04T15:00:00.000Z"'),
    "utf8",
  );
}

function internalReceiptFor(source: unknown) {
  const digests = createCaseVersionDigests(source);
  const content = {
    kind: "validated-case-import" as const,
    source,
    recordedVisibleBundleDigest: digests.visibleBundleDigest,
    recordedProtectedPackageDigest: digests.protectedPackageDigest,
  };
  return { ...content, validationDigest: sha256Digest(content) };
}

async function materializeStudentOutput(
  caseRoot: string,
  manifest: Awaited<ReturnType<typeof importCaseDirectory>>["studentBundleManifest"],
): Promise<string> {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "volta-student-output-"));
  for (const file of manifest.files) {
    const target = path.join(outputRoot, file.targetPath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(caseRoot, file.sourcePath), target);
  }
  return (
    await Promise.all(
      manifest.files.map((file) => readFile(path.join(outputRoot, file.targetPath), "utf8")),
    )
  ).join("\n");
}

describe("deterministic file-based case authoring", () => {
  it("normalizes a synthetic blank-origin variant through the same contract", async () => {
    const caseRoot = await copyFixture();
    const sourcePinsPath = path.join(caseRoot, "staff/source-pins.yaml");
    const sourcePins = await readFile(sourcePinsPath, "utf8");
    await writeFile(
      sourcePinsPath,
      sourcePins.replace("type: sanitized_reference_assisted", "type: original_from_blank"),
      "utf8",
    );
    await writeFile(
      path.join(caseRoot, "sanitized/reference.yaml"),
      "fixture_id: blank-origin-compatibility\nraw_source_present: false\nnote: No reference source was used to author this synthetic case.\n",
      "utf8",
    );

    const imported = await importCaseDirectory(caseRoot);

    expect(CaseVersionSourceSchema.safeParse(imported.source).success).toBe(true);
    expect(imported.source).toMatchObject({
      status: "draft",
      protected: {
        authoringProvenance: {
          path: "blank",
          rawSourceMaterialPresent: false,
          liveSourceAccessRequired: false,
        },
      },
    });
  });

  it("normalizes the multi-file fixture and binds protected authoring dimensions", async () => {
    const first = await importCaseDirectory(fixtureRoot);
    const second = await importCaseDirectory(fixtureRoot);

    expect(second.digests).toEqual(first.digests);
    expect(second.studentBundleManifest).toEqual(first.studentBundleManifest);
    expect(first.source).toMatchObject({
      status: "draft",
      visible: { assessmentUse: "non-assessed-example" },
      protected: {
        authoringProvenance: { path: "sanitized-reference-assisted" },
        economics: { currency: "CAD" },
      },
    });
    expect(first.publicationEligible).toBe(false);
    expect(first.publicationBlockers).toEqual([
      "The exact case version has no explicit approval.",
    ]);

    const calibrationDigests = first.source.protected.calibrationAnchors.map(
      ({ artifactDigest }) => artifactDigest,
    );
    expect(new Set(calibrationDigests).size).toBe(3);
    expect(
      first.source.protected.evidenceBehaviors?.find(
        ({ evidenceSourceId }) => evidenceSourceId === "evidence-weekly-counts",
      ),
    ).toMatchObject({ availability: "initial", outcomeClass: "partial" });
    expect(
      first.source.protected.routes.find(({ id }) => id === "collection-representative"),
    ).toMatchObject({
      releasedEvidenceIds: ["evidence-sample-a", "evidence-sample-b"],
      consequence: {
        time: { amount: 2, unit: "days" },
        risk: { suggestStaffReview: true, blocksSandboxWork: false },
      },
    });
    expect(
      first.studentBundleManifest.files.every(
        ({ sourcePath, targetPath }) =>
          ![sourcePath, targetPath].some((value) =>
            ["staff", "calibrations", "sanitized"].some(
              (root) => value === root || value.startsWith(`${root}/`),
            ),
          ),
      ),
    ).toBe(true);
  });

  it("runs complete cue groups, exclusions, multi-evidence release, and ambiguity fail-safe", async () => {
    const caseRoot = await copyFixture();
    await approveCaseFixture(caseRoot);
    const imported = await importCaseDirectory(caseRoot);
    expect(imported.publicationEligible).toBe(true);
    expect(() => publishCase(imported.source)).toThrow();
    const published = publishCase(internalReceiptFor(imported.source));
    const state = {
      assignmentId: "fixture-assignment",
      attemptNumber: 1,
      caseVersionDigest: published.digests.caseVersionDigest,
      currentEventSequence: 0,
      events: [],
    };
    const request = (question: string) => ({
      assignmentId: "fixture-assignment",
      attemptNumber: 1,
      channel: "collection" as const,
      targetId: "collection",
      question,
    });

    expect(resolveAuthoredRequest(published, request("representative"), state).status).toBe(
      "unavailable",
    );
    expect(
      resolveAuthoredRequest(published, request("representative sample"), state),
    ).toMatchObject({
      status: "matched",
      releasedEvidenceIds: ["evidence-sample-a", "evidence-sample-b"],
    });
    expect(
      resolveAuthoredRequest(published, request("representative sample private records"), state),
    ).toMatchObject({ status: "unavailable", releasedEvidenceIds: [] });

    const ambiguousPublished = published;
    expect(
      resolveAuthoredRequest(ambiguousPublished, request("representative sample quick"), {
        ...state,
        caseVersionDigest: ambiguousPublished.digests.caseVersionDigest,
      }),
    ).toMatchObject({
      status: "ambiguous",
      officialFacts: [],
      releasedEvidenceIds: [],
    });
  });

  it("rejects traversal, duplicate mappings, protected roots, and symlinks", async () => {
    const traversalRoot = await copyFixture();
    await replaceAssembly(traversalRoot, "source: student/README.md", "source: ../README.md");
    await expect(importCaseDirectory(traversalRoot)).rejects.toThrow(/normalized relative path/);

    const duplicateRoot = await copyFixture();
    await replaceAssembly(duplicateRoot, "target: method.md", "target: README.md");
    await expect(importCaseDirectory(duplicateRoot)).rejects.toThrow(/Duplicate student-bundle/);

    const protectedRoot = await copyFixture();
    await replaceAssembly(
      protectedRoot,
      "source: student/README.md",
      "source: staff/truth.yaml",
    );
    await expect(importCaseDirectory(protectedRoot)).rejects.toThrow(/protected roots/);

    const symlinkRoot = await copyFixture();
    await unlink(path.join(symlinkRoot, "student/README.md"));
    await symlink("method.md", path.join(symlinkRoot, "student/README.md"));
    await expect(importCaseDirectory(symlinkRoot)).rejects.toThrow(/symlinks/);
  });

  it("rejects Private/truth.yaml and Unicode or case variants of protected roots", async () => {
    for (const variant of ["Staff", "ｓｔａｆｆ", "Private", "ｐｒｉｖａｔｅ"]) {
      const caseRoot = await copyFixture();
      const variantDirectory = path.join(caseRoot, variant);
      try {
        await readFile(path.join(variantDirectory, "truth.yaml"));
      } catch {
        await mkdir(variantDirectory, { recursive: true });
        await cp(path.join(caseRoot, "staff/truth.yaml"), path.join(variantDirectory, "truth.yaml"));
      }
      await replaceAssembly(
        caseRoot,
        "source: student/README.md",
        `source: ${variant}/truth.yaml`,
      );
      await expect(importCaseDirectory(caseRoot)).rejects.toThrow(/protected roots/);
    }
  });

  it("requires the truth mapping, populated truth, known personas, and real evidence catalog", async () => {
    const missingMappingRoot = await copyFixture();
    const assemblyPath = path.join(missingMappingRoot, "staff/assembly.yaml");
    const assembly = await readFile(assemblyPath, "utf8");
    await writeFile(
      assemblyPath,
      assembly.replace(
        "  - { target_pointer: /truth, source_document: truth, source_pointer: /, operation: copy }\n",
        "",
      ),
      "utf8",
    );
    await expect(importCaseDirectory(missingMappingRoot)).rejects.toThrow(/exactly the required/);

    const emptyTruthRoot = await copyFixture();
    await writeFile(path.join(emptyTruthRoot, "staff/truth.yaml"), "{}\n", "utf8");
    await expect(importCaseDirectory(emptyTruthRoot)).rejects.toThrow();

    const unknownChampionRoot = await copyFixture();
    const truthPath = path.join(unknownChampionRoot, "staff/truth.yaml");
    const truth = await readFile(truthPath, "utf8");
    await writeFile(
      truthPath,
      truth.replace("champion: persona-librarian", "champion: persona-ghost"),
      "utf8",
    );
    await expect(importCaseDirectory(unknownChampionRoot)).rejects.toThrow(/unknown champion persona/);

    const ghostCatalogRoot = await copyFixture();
    await replaceAssembly(
      ghostCatalogRoot,
      "catalog_document: evidence",
      "catalog_document: ghost_catalog",
    );
    await expect(importCaseDirectory(ghostCatalogRoot)).rejects.toThrow(
      /must resolve to the declared evidence catalog/,
    );
  });

  it("strictly rejects malformed or delimiter-shifted CSV", () => {
    expect(parseCsv('a,b\n"one","two"\n', "valid.csv")).toHaveLength(2);
    for (const malformed of [
      'a,b\n"one"trailing,two\n',
      "a,b\none\n",
      'a,b\n"one,two\n',
      "a,A\none,two\n",
      "a;b\none;two\n",
      "a\tb\none\ttwo\n",
    ]) {
      expect(() => parseCsv(malformed, "malformed.csv")).toThrow();
    }
  });

  it("keeps protected canaries out of previews, errors, manifests, and student output", async () => {
    const caseRoot = await copyFixture();
    const canaries = {
      truth: "CANARY_TRUTH_7d12",
      calibration: "CANARY_CALIBRATION_f2a9",
      sanitized: "CANARY_SANITIZED_8be4",
      anchor: "CANARY_ANCHOR_c613",
    } as const;
    const seededFiles = [
      ["staff/truth.yaml", "Public Bicycle Library Cooperative", canaries.truth],
      [
        "calibrations/effective.yaml",
        "This public example links missing evidence to a falsifiable decision.",
        canaries.calibration,
      ],
      ["sanitized/reference.yaml", "public-sanitized-reference", canaries.sanitized],
      [
        "staff/anchors.yaml",
        "Treating a two-week count as a causal baseline.",
        canaries.anchor,
      ],
    ] as const;
    for (const [relativePath, existing, canary] of seededFiles) {
      const filePath = path.join(caseRoot, relativePath);
      const content = await readFile(filePath, "utf8");
      await writeFile(filePath, content.replace(existing, canary), "utf8");
      expect(await readFile(filePath, "utf8")).toContain(canary);
    }

    const imported = await importCaseDirectory(caseRoot);
    const previewJson = JSON.stringify(createCaseValidationPreview(imported));
    const visibleBundleJson = JSON.stringify(imported.source.visible);
    const manifestJson = JSON.stringify(imported.studentBundleManifest);
    const studentOutput = await materializeStudentOutput(
      caseRoot,
      imported.studentBundleManifest,
    );

    const truthPath = path.join(caseRoot, "staff/truth.yaml");
    const truth = await readFile(truthPath, "utf8");
    await writeFile(
      truthPath,
      truth.replace("champion: persona-librarian", "champion: persona-ghost"),
      "utf8",
    );
    const validationError = await importCaseDirectory(caseRoot).then(
      () => "unexpected success",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(validationError).toMatch(/unknown champion persona/);

    for (const canary of Object.values(canaries)) {
      expect(previewJson).not.toContain(canary);
      expect(visibleBundleJson).not.toContain(canary);
      expect(manifestJson).not.toContain(canary);
      expect(studentOutput).not.toContain(canary);
      expect(validationError).not.toContain(canary);
    }
  });

  it("isolates visible and protected material changes in preview digests", async () => {
    const baselineRoot = await copyFixture();
    const baseline = await importCaseDirectory(baselineRoot);

    const visibleRoot = await copyFixture();
    const briefPath = path.join(visibleRoot, "student/README.md");
    await writeFile(
      briefPath,
      `${await readFile(briefPath, "utf8")}\nA visible synthetic clarification.\n`,
      "utf8",
    );
    const visibleEdit = await importCaseDirectory(visibleRoot);
    expect(visibleEdit.digests.visibleBundleDigest).not.toBe(
      baseline.digests.visibleBundleDigest,
    );
    expect(visibleEdit.digests.protectedPackageDigest).toBe(
      baseline.digests.protectedPackageDigest,
    );
    expect(visibleEdit.digests.caseVersionDigest).not.toBe(
      baseline.digests.caseVersionDigest,
    );

    const protectedRoot = await copyFixture();
    const calibrationPath = path.join(protectedRoot, "calibrations/effective.yaml");
    await writeFile(
      calibrationPath,
      `${await readFile(calibrationPath, "utf8")}review_note: A protected synthetic clarification.\n`,
      "utf8",
    );
    const protectedEdit = await importCaseDirectory(protectedRoot);
    expect(protectedEdit.digests.visibleBundleDigest).toBe(
      baseline.digests.visibleBundleDigest,
    );
    expect(protectedEdit.digests.protectedPackageDigest).not.toBe(
      baseline.digests.protectedPackageDigest,
    );
    expect(protectedEdit.digests.caseVersionDigest).not.toBe(
      baseline.digests.caseVersionDigest,
    );
  });

  it("requires distinct non-placeholder calibration artifacts for assessed cases", async () => {
    const imported = await importCaseDirectory(fixtureRoot);
    const assessed = structuredClone(imported.source);
    assessed.visible.assessmentUse = "assessed";
    const placeholder = `sha256:${"0".repeat(64)}` as const;
    assessed.protected.calibrationAnchors[0]!.artifactDigest = placeholder;
    assessed.protected.calibrationAnchors[1]!.artifactDigest = placeholder;
    assessed.protected.calibrationAnchors[2]!.artifactDigest = placeholder;
    const result = CaseVersionSourceSchema.safeParse(assessed);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(({ message }) =>
          message.includes("distinct non-placeholder calibration"),
        ),
      ).toBe(true);
    }
  });

  it("rejects an unknown fact reference inside a calibration artifact", async () => {
    const caseRoot = await copyFixture();
    const calibrationPath = path.join(caseRoot, "calibrations/effective.yaml");
    const current = await readFile(calibrationPath, "utf8");
    await writeFile(
      calibrationPath,
      `${current}supporting_reference:\n  fact_id: fact-not-authored\n`,
      "utf8",
    );
    await expect(importCaseDirectory(caseRoot)).rejects.toThrow(/Unknown calibration fact reference/);
  });
});
