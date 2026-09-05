import path from "node:path";
import { CaseVersionSourceSchema, type CaseVersionSource } from "@volta-sim/contracts";
import { z } from "zod";
import {
  canonicalCasePath,
  loadCaseAssembly,
  readCaseFile,
  validateRelativeCasePath,
  type LoadedAssembly,
  type LoadedCaseFile,
} from "./assembly.js";
import {
  createPreviewDigests,
  previewDigest,
  type CasePreviewDigests,
} from "./preview-digests.js";
import {
  AnchorsFileSchema,
  BoundariesFileSchema,
  CalibrationFileSchema,
  CaseFileSchema,
  CollectionFileSchema,
  EconomicsFileSchema,
  EvidenceFileSchema,
  PersonasFileSchema,
  RequirementsFileSchema,
  RouteValidationFileSchema,
  SourcePinsFileSchema,
  TruthFileSchema,
  ValidationRecordSchema,
} from "./source-schemas.js";

type StudentAsset = NonNullable<CaseVersionSource["visible"]["studentAssets"]>[number];

export interface StudentBundleManifest {
  readonly caseId: string;
  readonly versionLabel: string;
  readonly visibleBundleDigest: `sha256:${string}`;
  readonly files: readonly StudentAsset[];
  readonly manifestDigest: `sha256:${string}`;
}

export interface CaseImportResult {
  readonly source: CaseVersionSource;
  readonly digests: CasePreviewDigests;
  readonly studentBundleManifest: StudentBundleManifest;
  readonly publicationEligible: boolean;
  readonly publicationBlockers: readonly string[];
}

export interface CaseValidationPreview {
  readonly valid: true;
  readonly status: CaseVersionSource["status"];
  readonly caseId: string;
  readonly versionLabel: string;
  readonly digests: CasePreviewDigests;
  readonly studentBundleManifest: StudentBundleManifest;
  readonly publicationEligible: boolean;
  readonly publicationBlockers: readonly string[];
}

export function createCaseValidationPreview(result: CaseImportResult): CaseValidationPreview {
  return {
    valid: true,
    status: result.source.status,
    caseId: result.source.visible.caseId,
    versionLabel: result.source.visible.versionLabel,
    digests: result.digests,
    studentBundleManifest: result.studentBundleManifest,
    publicationEligible: result.publicationEligible,
    publicationBlockers: result.publicationBlockers,
  };
}

function normalizedDocument(assembly: LoadedAssembly, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(assembly.normalized, key)) {
    throw new Error(`The assembly did not map required normalized target /${key}`);
  }
  return assembly.normalized[key];
}

function contentFormat(relativePath: string): LoadedCaseFile["format"] {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".md":
      return "markdown";
    case ".csv":
      return "csv";
    case ".txt":
      return "text";
    default:
      throw new Error(`Unsupported case asset type: ${relativePath}`);
  }
}

function mediaType(relativePath: string): StudentAsset["mediaType"] {
  switch (contentFormat(relativePath)) {
    case "yaml":
      return "application/yaml";
    case "markdown":
      return "text/markdown";
    case "csv":
      return "text/csv";
    case "text":
      return "text/plain";
  }
}

function authoredCue(value: string): string {
  return value.replaceAll("_", " ");
}

function stableId(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 100);
  if (normalized.length === 0) throw new Error(`Cannot produce a stable id from: ${value}`);
  return normalized;
}

function duplicateValues(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort();
}

function startsWithRoot(relativePath: string, root: string): boolean {
  return relativePath === root || relativePath.startsWith(`${root}/`);
}

function ensureDocumentReference(
  loaded: LoadedAssembly,
  relativePath: string,
  label: string,
): void {
  validateRelativeCasePath(relativePath, label);
  if (![...loaded.filesByDocumentId.values()].some((file) => file.relativePath === relativePath)) {
    throw new Error(`${label} is not declared in the assembly documents: ${relativePath}`);
  }
}

async function loadStudentAssets(
  loaded: LoadedAssembly,
): Promise<readonly StudentAsset[]> {
  const authoredForbiddenRoots = loaded.assembly.student_bundle.forbidden_roots.map((root) =>
    canonicalCasePath(validateRelativeCasePath(root, "Forbidden student-bundle root")),
  );
  const sources = loaded.assembly.student_bundle.always_copy.map(({ source }) => source);
  const targets = loaded.assembly.student_bundle.always_copy.map(({ target }) => target);
  const duplicateSources = duplicateValues(sources.map(canonicalCasePath));
  const duplicateTargets = duplicateValues(targets.map(canonicalCasePath));
  if (duplicateSources.length > 0 || duplicateTargets.length > 0) {
    throw new Error(
      `Duplicate student-bundle mappings are not allowed${
        duplicateSources.length > 0 ? `; sources: ${duplicateSources.join(", ")}` : ""
      }${duplicateTargets.length > 0 ? `; targets: ${duplicateTargets.join(", ")}` : ""}`,
    );
  }

  const protectedDocumentPaths = new Set(
    loaded.assembly.documents
      .filter(({ visibility }) => visibility === "protected")
      .map(({ id }) => loaded.filesByDocumentId.get(id))
      .filter((file): file is LoadedCaseFile => file !== undefined)
      .map(({ realRelativePath }) => canonicalCasePath(realRelativePath)),
  );
  const protectedDocumentRoots = loaded.assembly.documents
    .filter(({ visibility }) => visibility === "protected")
    .map(({ id }) => loaded.filesByDocumentId.get(id))
    .filter(
      (file): file is LoadedCaseFile =>
        file !== undefined && file.realRelativePath.includes("/"),
    )
    .map(({ realRelativePath }) => canonicalCasePath(realRelativePath).split("/")[0]!);
  const forbiddenRoots = [...new Set([...authoredForbiddenRoots, ...protectedDocumentRoots])];
  const assets: StudentAsset[] = [];
  const resolvedSourcePaths = new Set<string>();
  for (const copy of loaded.assembly.student_bundle.always_copy) {
    const sourcePath = validateRelativeCasePath(copy.source, "Student-bundle source");
    const targetPath = validateRelativeCasePath(copy.target, "Student-bundle target");
    const loadedFile = await readCaseFile(loaded.root, sourcePath, contentFormat(sourcePath));
    const canonicalSourcePath = canonicalCasePath(loadedFile.realRelativePath);
    const canonicalTargetPath = canonicalCasePath(targetPath);
    if (resolvedSourcePaths.has(canonicalSourcePath)) {
      throw new Error(`Duplicate student-bundle source after filesystem resolution: ${sourcePath}`);
    }
    resolvedSourcePaths.add(canonicalSourcePath);
    if (
      protectedDocumentPaths.has(canonicalSourcePath) ||
      forbiddenRoots.some(
        (root) =>
          startsWithRoot(canonicalSourcePath, root) || startsWithRoot(canonicalTargetPath, root),
      )
    ) {
      throw new Error(`Student-bundle mappings cannot include protected roots: ${sourcePath}`);
    }
    assets.push({
      sourcePath,
      targetPath,
      mediaType: mediaType(sourcePath),
      byteLength: loadedFile.byteLength,
      digest: loadedFile.digest,
    });
  }
  return assets;
}

function difficultyDimension(
  rationale: string,
): "ambiguity" | "data-availability" | "stakeholder-complexity" | "solution-risk" | "economic-uncertainty" {
  const value = rationale.toLowerCase();
  if (value.includes("stakeholder")) return "stakeholder-complexity";
  if (value.includes("economic") || value.includes("baseline")) return "economic-uncertainty";
  if (value.includes("privacy") || value.includes("software") || value.includes("risk")) {
    return "solution-risk";
  }
  if (value.includes("sample") || value.includes("data")) return "data-availability";
  return "ambiguity";
}

function competencyId(
  sourceId: string,
): "problem-viability" | "evidence-sufficiency" | "response-feasibility" | "objective-success-criteria" {
  const mapping = {
    "competency-problem-viability": "problem-viability",
    "competency-evidence-sufficiency": "evidence-sufficiency",
    "competency-proportionate-feasibility": "response-feasibility",
    "competency-objective-criteria": "objective-success-criteria",
  } as const;
  const result = mapping[sourceId as keyof typeof mapping];
  if (result === undefined) throw new Error(`Unknown mandatory competency mapping: ${sourceId}`);
  return result;
}

function competencyPrompt(id: ReturnType<typeof competencyId>): string {
  switch (id) {
    case "problem-viability":
      return "Explain whether this recurring problem warrants action without assuming a solution.";
    case "evidence-sufficiency":
      return "Separate official facts, assumptions, contradictions, and unknowns, then address decision-critical gaps.";
    case "response-feasibility":
      return "Defend why the response is proportionate to the evidence, constraints, economics, and risk.";
    case "objective-success-criteria":
      return "State a baseline or baseline plan, target, date, economic link, and failure, pivot, and stop criteria.";
  }
}

function evidenceKind(entry: z.infer<typeof EvidenceFileSchema>["entries"][number]) {
  if (entry.path === null) return "collection-opportunity" as const;
  if (contentFormat(entry.path) === "csv") return "dataset" as const;
  return "file" as const;
}

function outcomeKind(
  entries: readonly z.infer<typeof EvidenceFileSchema>["entries"][number][],
): "release" | "partial" | "unavailable" {
  if (entries.length === 0 || entries.every(({ availability }) => availability === "unavailable")) {
    return "unavailable";
  }
  return entries.every(({ outcome_class: outcome }) => outcome === "complete")
    ? "release"
    : "partial";
}

function partialLimitation(
  entries: readonly z.infer<typeof EvidenceFileSchema>["entries"][number][],
): string {
  const limitations = entries.flatMap(({ limitations }) => limitations ?? []);
  if (limitations.length > 0) return limitations.join(" ");
  if (entries.some(({ student_visible_sampling_frame: frame }) => frame !== undefined)) {
    return "Interpret the result only within its recorded sampling frame and exclusions.";
  }
  return "Interpret the result only within its recorded collection method and provenance.";
}

function sourceForFact(
  sourceMap: ReadonlyMap<string, readonly { channel: "persona" | "evidence"; targetId: string }[]>,
  factId: string,
) {
  const sources = sourceMap.get(factId);
  if (sources === undefined || sources.length === 0) {
    throw new Error(`Authoritative fact is unreachable from every authored source: ${factId}`);
  }
  return { source: sources[0]!, additionalSources: sources.slice(1) };
}

function economicUnit(id: string, currency: string): string | undefined {
  if (id.endsWith("_cad")) return currency;
  if (id.endsWith("_fraction")) return "fraction";
  if (id.endsWith("_percent")) return "percent";
  if (id.includes("hours")) return "hours";
  if (id.includes("weeks")) return "weeks";
  return undefined;
}

function validateNestedReferences(
  value: unknown,
  factIds: ReadonlySet<string>,
  evidenceIds: ReadonlySet<string>,
  location: string,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNestedReferences(item, factIds, evidenceIds, `${location}.${index}`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "fact_id" && (typeof nested !== "string" || !factIds.has(nested))) {
      throw new Error(`Unknown calibration fact reference at ${location}.${key}: ${String(nested)}`);
    }
    if (key === "evidence_id" && (typeof nested !== "string" || !evidenceIds.has(nested))) {
      throw new Error(`Unknown calibration evidence reference at ${location}.${key}: ${String(nested)}`);
    }
    validateNestedReferences(nested, factIds, evidenceIds, `${location}.${key}`);
  }
}

function validateAuthoredRouteTests(
  personas: z.infer<typeof PersonasFileSchema>,
  collections: z.infer<typeof CollectionFileSchema>,
  evidence: z.infer<typeof EvidenceFileSchema>,
  validation: z.infer<typeof RouteValidationFileSchema>,
): void {
  const evidenceById = new Map(evidence.entries.map((entry) => [entry.id, entry]));
  for (const test of validation.test_cases) {
    if (
      test.route_type === "persona" &&
      (test.persona_id === undefined || !personas.personas.some(({ id }) => id === test.persona_id))
    ) {
      throw new Error(`Authored route validation ${test.id} references an unknown persona`);
    }
    const intents = new Set(test.canonical_intent_ids);
    const releasedEvidence = new Set(test.released_evidence_ids ?? []);
    const candidates =
      test.route_type === "persona"
        ? personas.personas
            .filter(({ id }) => id === test.persona_id)
            .flatMap(({ routes }) => routes)
            .filter(
              ({ canonical_match: match }) =>
                match.any_of.some((intent) => intents.has(intent)) &&
                match.none_of.every((intent) => !intents.has(intent)),
            )
            .map((route) => ({
              id: route.id,
              priority: route.priority,
              factIds: route.releases,
              evidenceIds: [] as string[],
              advanceBusinessDays: 0,
            }))
        : collections.rules
            .filter(({ canonical_match: match, prerequisites }) => {
              const allMatch = match.all_of.every((intent) => intents.has(intent));
              const groupMatch =
                match.any_groups.length === 0 ||
                match.any_groups.some((group) => group.every((intent) => intents.has(intent)));
              const exclusionsAbsent = match.none_of.every((intent) => !intents.has(intent));
              const prerequisitesMet = (prerequisites?.evidence_released ?? []).every((id) =>
                releasedEvidence.has(id),
              );
              return allMatch && groupMatch && exclusionsAbsent && prerequisitesMet;
            })
            .map((route) => ({
              id: route.id,
              priority: route.priority,
              factIds: route.releases.flatMap((id) => evidenceById.get(id)?.releases ?? []),
              evidenceIds: route.releases,
              advanceBusinessDays: route.advance_business_days,
            }));

    const highestPriority =
      candidates.length === 0 ? undefined : Math.max(...candidates.map(({ priority }) => priority));
    const winners = candidates.filter(({ priority }) => priority === highestPriority);
    const actual =
      winners.length > 1
        ? {
            status: "ambiguous" as const,
            routeId: null,
            factIds: [] as string[],
            evidenceIds: [] as string[],
            advanceBusinessDays: 0,
          }
        : winners.length === 1
          ? {
              status: "matched" as const,
              routeId: winners[0]!.id,
              factIds: [...new Set(winners[0]!.factIds)].sort(),
              evidenceIds: [...new Set(winners[0]!.evidenceIds)].sort(),
              advanceBusinessDays: winners[0]!.advanceBusinessDays,
            }
          : {
              status: "unavailable" as const,
              routeId: test.route_type === "collection" ? collections.fallback.id : null,
              factIds: [] as string[],
              evidenceIds: [] as string[],
              advanceBusinessDays: 0,
            };
    const expected = test.expected;
    const mismatches = [
      actual.status === expected.status ? undefined : `status ${actual.status}`,
      expected.route_id === undefined || actual.routeId === expected.route_id
        ? undefined
        : `route ${String(actual.routeId)}`,
      expected.fact_ids === undefined ||
      JSON.stringify(actual.factIds) === JSON.stringify([...expected.fact_ids].sort())
        ? undefined
        : `facts ${actual.factIds.join(",")}`,
      expected.evidence_ids === undefined ||
      JSON.stringify(actual.evidenceIds) === JSON.stringify([...expected.evidence_ids].sort())
        ? undefined
        : `evidence ${actual.evidenceIds.join(",")}`,
      expected.advance_business_days === undefined ||
      actual.advanceBusinessDays === expected.advance_business_days
        ? undefined
        : `advance ${actual.advanceBusinessDays}`,
    ].filter((value): value is string => value !== undefined);
    if (mismatches.length > 0) {
      throw new Error(`Authored route validation ${test.id} failed: ${mismatches.join("; ")}`);
    }
  }
}

async function normalizeCase(loaded: LoadedAssembly): Promise<CaseVersionSource> {
  const caseFile = CaseFileSchema.parse(normalizedDocument(loaded, "case"));
  const requirements = RequirementsFileSchema.parse(normalizedDocument(loaded, "requirements"));
  const personas = PersonasFileSchema.parse({
    schema_version: "0.1",
    grounding_rule: z.string().parse(
      (loaded.filesByDocumentId.get("personas")?.parsed as Record<string, unknown> | undefined)
        ?.grounding_rule,
    ),
    fallback_rule: z.string().parse(
      (loaded.filesByDocumentId.get("personas")?.parsed as Record<string, unknown> | undefined)
        ?.fallback_rule,
    ),
    route_resolution: normalizedDocument(loaded, "persona_route_resolution"),
    personas: normalizedDocument(loaded, "personas"),
  });
  const evidenceDocument = EvidenceFileSchema.parse(
    loaded.filesByDocumentId.get("evidence")?.parsed,
  );
  const evidence = EvidenceFileSchema.parse({
    ...evidenceDocument,
    entries: normalizedDocument(loaded, "evidence"),
    fact_index: normalizedDocument(loaded, "fact_index"),
  });
  const collectionsDocument = loaded.filesByDocumentId.get("collections")?.parsed;
  const collectionMetadata = CollectionFileSchema.parse(collectionsDocument);
  const collections = CollectionFileSchema.parse({
    ...collectionMetadata,
    rules: normalizedDocument(loaded, "collection_routes"),
    route_resolution: normalizedDocument(loaded, "collection_route_resolution"),
    fallback: normalizedDocument(loaded, "collection_fallback"),
  });
  const truth = TruthFileSchema.parse(normalizedDocument(loaded, "truth"));
  const economics = EconomicsFileSchema.parse(normalizedDocument(loaded, "economics"));
  const anchors = AnchorsFileSchema.parse(normalizedDocument(loaded, "evaluation_anchors"));
  const boundaries = BoundariesFileSchema.parse(normalizedDocument(loaded, "decision_boundaries"));
  const sourcePins = SourcePinsFileSchema.parse(normalizedDocument(loaded, "source_pins"));
  const validationRecord = ValidationRecordSchema.parse(normalizedDocument(loaded, "validation_record"));
  const routeValidation = RouteValidationFileSchema.parse(
    normalizedDocument(loaded, "route_validation"),
  );
  const calibrationInputs = [
    normalizedDocument(loaded, "calibrations") as Record<string, unknown>,
  ][0]!;
  const calibrations = [
    CalibrationFileSchema.parse(calibrationInputs.effective),
    CalibrationFileSchema.parse(calibrationInputs.partially_effective),
    CalibrationFileSchema.parse(calibrationInputs.not_yet_effective),
  ];
  validateAuthoredRouteTests(personas, collections, evidence, routeValidation);

  const catalogDocumentId = loaded.assembly.student_bundle.released_evidence.catalog_document;
  const catalogDocument = loaded.assembly.documents.find(({ id }) => id === catalogDocumentId);
  if (
    catalogDocumentId !== "evidence" ||
    catalogDocument === undefined ||
    catalogDocument.visibility !== "protected" ||
    catalogDocument.path !== caseFile.evidence_catalog_ref ||
    loaded.assembly.student_bundle.released_evidence.id_pointer !== "/entries/*/id" ||
    loaded.assembly.student_bundle.released_evidence.path_pointer !== "/entries/*/path" ||
    loaded.assembly.student_bundle.released_evidence.target_pattern !==
      "evidence/{evidence_id}/{basename}"
  ) {
    throw new Error("released_evidence.catalog_document must resolve to the declared evidence catalog");
  }

  const referencedDocuments = [
    [caseFile.assembly_ref, "Assembly reference"],
    [caseFile.route_validation_ref, "Route validation reference"],
    [caseFile.validation_record_ref, "Validation-record reference"],
    [caseFile.origin.private_metadata_ref, "Origin metadata reference"],
    [caseFile.methodology_snapshot.requirements_ref, "Requirements snapshot reference"],
    [caseFile.methodology_snapshot.private_source_ref, "Methodology pin reference"],
    [caseFile.personas_ref, "Personas reference"],
    [caseFile.truth_ref, "Truth reference"],
    [caseFile.evidence_catalog_ref, "Evidence-catalog reference"],
    [caseFile.collection_consequences_ref, "Collection reference"],
    [caseFile.economics_ref, "Economics reference"],
    [caseFile.evaluation_anchors_ref, "Evaluation-anchor reference"],
    [caseFile.boundaries_ref, "Decision-boundary reference"],
    [caseFile.reference_import_fixture, "Sanitized-reference fixture"],
    ...caseFile.calibrations.map((value) => [value, "Calibration reference"] as const),
  ] as const;
  for (const [relativePath, label] of referencedDocuments) {
    if (relativePath === caseFile.assembly_ref) {
      if (relativePath !== loaded.assemblyPath) throw new Error("case.yaml points to another assembly");
    } else {
      ensureDocumentReference(loaded, relativePath, label);
    }
  }
  validateRelativeCasePath(caseFile.methodology_snapshot.student_ref, "Methodology student reference");
  validateRelativeCasePath(caseFile.visible_bundle.brief, "Student brief reference");
  validateRelativeCasePath(caseFile.visible_bundle.rubric, "Student rubric reference");
  validateRelativeCasePath(caseFile.visible_bundle.requirements, "Student requirements reference");

  const studentAssets = await loadStudentAssets(loaded);
  const studentSourcePaths = new Set(studentAssets.map(({ sourcePath }) => sourcePath));
  for (const requiredStudentPath of [
    caseFile.visible_bundle.brief,
    caseFile.visible_bundle.rubric,
    caseFile.visible_bundle.requirements,
    caseFile.methodology_snapshot.student_ref,
    caseFile.methodology_snapshot.requirements_ref,
  ]) {
    if (!studentSourcePaths.has(requiredStudentPath)) {
      throw new Error(`Student-visible source is missing from the explicit allowlist: ${requiredStudentPath}`);
    }
  }

  const evidenceById = new Map(evidence.entries.map((entry) => [entry.id, entry]));
  if (evidenceById.size !== evidence.entries.length) throw new Error("Duplicate evidence ids");
  const duplicateEvidencePaths = duplicateValues(
    evidence.entries.flatMap(({ path: evidencePath }) =>
      evidencePath === null ? [] : [evidencePath],
    ),
  );
  if (duplicateEvidencePaths.length > 0) {
    throw new Error(`Duplicate evidence asset mappings: ${duplicateEvidencePaths.join(", ")}`);
  }
  const knownFactIds = new Set(Object.keys(evidence.fact_index));
  const knownEvidenceIds = new Set(evidenceById.keys());
  calibrations.forEach((calibration, index) =>
    validateNestedReferences(
      calibration,
      knownFactIds,
      knownEvidenceIds,
      `calibrations.${index}`,
    ),
  );
  for (const entry of evidence.entries) {
    if (entry.availability === "on_purposeful_request" && (entry.request_intents?.length ?? 0) === 0) {
      throw new Error(`Purposeful-request evidence needs authored request cues: ${entry.id}`);
    }
    if (entry.availability !== "after_collection" && entry.collection_route !== undefined) {
      throw new Error(`Only collected evidence may declare a collection route: ${entry.id}`);
    }
  }
  for (const evidenceId of caseFile.visible_bundle.initial_evidence) {
    const entry = evidenceById.get(evidenceId);
    if (entry?.availability !== "initial" || entry.path === null || !studentSourcePaths.has(entry.path)) {
      throw new Error(`Initial evidence must be available and included in the student allowlist: ${evidenceId}`);
    }
  }

  const evidenceAssets = new Map<string, LoadedCaseFile>();
  for (const entry of evidence.entries) {
    if (entry.path === null) continue;
    evidenceAssets.set(entry.id, await readCaseFile(loaded.root, entry.path, contentFormat(entry.path)));
  }

  const collectionById = new Map(collections.rules.map((rule) => [rule.id, rule]));
  if (collectionById.size !== collections.rules.length) throw new Error("Duplicate collection route ids");
  for (const entry of evidence.entries) {
    if (entry.availability === "after_collection") {
      if (entry.collection_route === undefined || !collectionById.has(entry.collection_route)) {
        throw new Error(`Evidence ${entry.id} needs a known collection route`);
      }
      if (!collectionById.get(entry.collection_route)!.releases.includes(entry.id)) {
        throw new Error(`Collection route ${entry.collection_route} does not release ${entry.id}`);
      }
    }
  }
  for (const rule of collections.rules) {
    for (const evidenceId of [...rule.releases, ...(rule.prerequisites?.evidence_released ?? [])]) {
      if (!evidenceById.has(evidenceId)) {
        throw new Error(`Collection route ${rule.id} references unknown evidence ${evidenceId}`);
      }
    }
    for (const evidenceId of rule.releases) {
      if (evidenceById.get(evidenceId)?.collection_route !== rule.id) {
        throw new Error(`Collection route ${rule.id} is not the declared source for ${evidenceId}`);
      }
    }
  }

  if (truth.case_id !== caseFile.case_id) {
    throw new Error("The protected truth must bind the authored case id");
  }
  const personaIds = new Set(personas.personas.map(({ id }) => id));
  for (const [role, personaId] of Object.entries(truth.stakeholder_truth)) {
    if (!personaIds.has(personaId)) {
      throw new Error(`Protected truth references unknown ${role} persona: ${personaId}`);
    }
  }

  const expectedDocumentPaths = new Map([
    ["requirements", caseFile.methodology_snapshot.requirements_ref],
    ["personas", caseFile.personas_ref],
    ["truth", caseFile.truth_ref],
    ["evidence", caseFile.evidence_catalog_ref],
    ["collections", caseFile.collection_consequences_ref],
    ["economics", caseFile.economics_ref],
    ["anchors", caseFile.evaluation_anchors_ref],
    ["boundaries", caseFile.boundaries_ref],
    ["source_pins", caseFile.methodology_snapshot.private_source_ref],
    ["route_validation", caseFile.route_validation_ref],
    ["validation_record", caseFile.validation_record_ref],
    ["calibration_effective", caseFile.calibrations[0]!],
    ["calibration_partial", caseFile.calibrations[1]!],
    ["calibration_not_yet", caseFile.calibrations[2]!],
    ["sanitized_reference", caseFile.reference_import_fixture],
  ]);
  for (const [documentId, expectedPath] of expectedDocumentPaths) {
    const actualPath = loaded.filesByDocumentId.get(documentId)?.relativePath;
    if (actualPath !== expectedPath) {
      throw new Error(
        `Assembly document ${documentId} must match its case reference ${expectedPath}; received ${String(actualPath)}`,
      );
    }
  }

  const factSources = new Map<
    string,
    { channel: "persona" | "evidence"; targetId: string }[]
  >();
  const addFactSource = (
    factId: string,
    authoredSource: { channel: "persona" | "evidence"; targetId: string },
  ): void => {
    if (!(factId in evidence.fact_index)) throw new Error(`Unknown authored fact reference: ${factId}`);
    const sources = factSources.get(factId) ?? [];
    if (!sources.some(
      ({ channel, targetId }) => channel === authoredSource.channel && targetId === authoredSource.targetId,
    )) sources.push(authoredSource);
    factSources.set(factId, sources);
  };
  for (const persona of personas.personas) {
    for (const factId of persona.opening.releases) {
      addFactSource(factId, { channel: "persona", targetId: persona.id });
    }
    for (const route of persona.routes) {
      for (const factId of route.releases) {
        addFactSource(factId, { channel: "persona", targetId: persona.id });
      }
    }
  }
  for (const entry of evidence.entries) {
    for (const factId of entry.releases) {
      addFactSource(factId, { channel: "evidence", targetId: entry.id });
    }
  }

  const personaRoutes = personas.personas.flatMap((persona) =>
    persona.routes.map((route) => ({
      id: route.id,
      channel: "persona",
      targetId: persona.id,
      priority: route.priority,
      match: {
        anyPhrases: route.canonical_match.any_of.map(authoredCue),
        allTerms: [],
        anyTermGroups: [],
        noneTerms: route.canonical_match.none_of.map(authoredCue),
      },
      prerequisiteFactIds: [],
      prerequisiteEvidenceIds: [],
      releasedEvidenceIds: [],
      consequence: {
        id: `${route.id}-consequence`,
        time: { amount: 0, unit: "minutes" },
        resources: [],
        evidenceOutcome: "release",
      },
      outcome: {
        kind: "release",
        factIds: route.releases,
        studentMessage: route.response_points.join(" "),
      },
    })),
  );

  const directEvidenceRoutes = evidence.entries
    .filter(({ availability }) =>
      availability === "on_purposeful_request" || availability === "unavailable",
    )
    .map((entry) => {
      const kind = outcomeKind([entry]);
      const cues =
        entry.request_intents?.map(authoredCue) ?? [authoredCue(entry.id), entry.title.toLowerCase()];
      const shared = {
        id: `request-${entry.id}`,
        channel: "evidence",
        targetId: entry.id,
        priority: 100,
        match: { anyPhrases: cues, allTerms: [], anyTermGroups: [], noneTerms: [] },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: kind === "unavailable" ? [] : [entry.id],
        consequence: {
          id: `request-${entry.id}-consequence`,
          time: { amount: 0, unit: "minutes" },
          resources: [],
          evidenceOutcome: kind,
        },
      };
      if (kind === "unavailable") {
        return {
          ...shared,
          outcome: {
            kind,
            factIds: [],
            studentMessage: entry.reason ?? caseFile.out_of_universe.message,
          },
        };
      }
      if (kind === "partial") {
        return {
          ...shared,
          outcome: {
            kind,
            factIds: entry.releases,
            studentMessage: `${entry.title} is available with its provenance and collection method recorded.`,
            limitation: partialLimitation([entry]),
          },
        };
      }
      return {
        ...shared,
        outcome: {
          kind,
          factIds: entry.releases,
          studentMessage: `${entry.title} is available with its provenance recorded.`,
        },
      };
    });

  const collectionRoutes = collections.rules.map((rule) => {
    const releasedEntries = rule.releases.map((id) => evidenceById.get(id)!);
    const kind = outcomeKind(releasedEntries);
    const factIds = [...new Set(releasedEntries.flatMap(({ releases }) => releases))].sort();
    const risk =
      rule.risk === undefined
        ? undefined
        : {
            level: rule.risk.level,
            suggestStaffReview: rule.risk.suggest_staff_review,
            blocksSandboxWork: rule.risk.blocks_sandbox_work,
          };
    const shared = {
      id: rule.id,
      channel: "collection",
      targetId: "collection",
      priority: rule.priority,
      match: {
        anyPhrases: [],
        allTerms: rule.canonical_match.all_of.map(authoredCue),
        anyTermGroups: rule.canonical_match.any_groups.map((group) => group.map(authoredCue)),
        noneTerms: rule.canonical_match.none_of.map(authoredCue),
      },
      prerequisiteFactIds: [],
      prerequisiteEvidenceIds: rule.prerequisites?.evidence_released ?? [],
      releasedEvidenceIds: rule.releases,
      consequence: {
        id: `${rule.id}-consequence`,
        time: { amount: rule.advance_business_days, unit: "days" },
        resources: Object.entries(rule.resource_cost).map(([id, amount]) => ({
          id: stableId(id),
          amount,
          unit: id.endsWith("_hours") ? "hours" : stableId(id),
        })),
        ...(risk === undefined ? {} : { risk }),
        evidenceOutcome: kind,
      },
    };
    if (kind === "partial") {
      return {
        ...shared,
        outcome: {
          kind,
          factIds,
          studentMessage: rule.student_result_note,
          limitation: partialLimitation(releasedEntries),
        },
      };
    }
    return {
      ...shared,
      outcome: { kind, factIds, studentMessage: rule.student_result_note },
    };
  });

  const calibrationDocumentIds = [
    "calibration_effective",
    "calibration_partial",
    "calibration_not_yet",
  ];
  const calibrationClass = {
    effective: "effective",
    partially_effective: "partially-effective",
    not_yet_effective: "not-yet-effective",
  } as const;

  const methodologyFile = await readCaseFile(
    loaded.root,
    caseFile.methodology_snapshot.student_ref,
    "markdown",
  );
  const requirementsFile = loaded.filesByDocumentId.get("requirements");
  if (requirementsFile === undefined) throw new Error("Requirements source document is missing");
  const briefFile = await readCaseFile(loaded.root, caseFile.visible_bundle.brief, "markdown");
  const referenceImport = z
    .object({ input: z.record(z.unknown()), expected: z.record(z.unknown()) })
    .strict()
    .parse(normalizedDocument(loaded, "reference_import"));
  if (sourcePins.case_origin.type === "sanitized_reference_assisted") {
    if (referenceImport.input.raw_source_present !== false) {
      throw new Error("Sanitized-reference-assisted authoring cannot include raw source material");
    }
    if (referenceImport.expected.case_id !== caseFile.case_id) {
      throw new Error("Sanitized reference expected output must bind the authored case id");
    }
  }
  const caseAuthoringContent = Object.fromEntries(
    Object.entries(caseFile).filter(([key]) => key !== "publication" && key !== "status"),
  );

  const source = CaseVersionSourceSchema.parse({
    status: caseFile.status,
    visible: {
      caseId: caseFile.case_id,
      versionLabel: caseFile.version,
      assessmentUse: caseFile.assessment_use ?? "assessed",
      title: caseFile.student_title,
      brief: briefFile.text,
      difficulty: {
        audience: "Contractor students investigating a simulated AI-adoption problem",
        experienceLevel: caseFile.experience_level,
        factors: caseFile.difficulty.deliberate_factors.map((rationale, index) => ({
          id: `difficulty-${index + 1}-${stableId(rationale).slice(0, 60)}`,
          dimension: difficultyDimension(rationale),
          level: index === 1 ? "medium" : "high",
          rationale,
        })),
      },
      constraints: boundaries.unacceptable_outcomes.map(({ text }) => text),
      unacceptableOutcomes: boundaries.unacceptable_outcomes.map(({ text }) => text),
      nonExhaustiveResponseFamilies: boundaries.defensible_response_families_non_exhaustive.map(
        ({ response }) => response,
      ),
      competencies: caseFile.competencies.map(({ id: sourceId, label }) => {
        const id = competencyId(sourceId);
        return { id, title: label, studentPrompt: competencyPrompt(id) };
      }),
      requirements: requirements.requirements.map((requirement) => ({
        id: requirement.key,
        title: requirement.label,
        prompt: requirement.label,
        applicability:
          requirement.gate !== undefined || requirement.optional === true
            ? "student-may-mark-not-applicable"
            : "applicable",
        stage: requirement.stage,
        ...(requirement.gate === undefined ? {} : { gate: requirement.gate }),
        ...(requirement.optional === undefined ? {} : { optional: requirement.optional }),
        initialState: requirement.initial_state,
      })),
      personas: personas.personas.map((persona) => ({
        id: persona.id,
        name: persona.display_name,
        role: `${persona.title}; ${persona.roles.map(authoredCue).join(", ")}`,
        studentBrief: persona.opening.points.join(" "),
      })),
      evidenceSources: evidence.entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        kind: evidenceKind(entry),
        studentBrief:
          entry.availability === "unavailable"
            ? "This evidence may be requested, but the fixed simulation can report it unavailable."
            : "This frozen source may be released only through its authored availability rule.",
      })),
      studentAssets,
    },
    protected: {
      facts: Object.entries(evidence.fact_index).map(([id, claim]) => ({
        id,
        claim,
        provenance: "Frozen authoritative fact index with release limited to the authored sources.",
        ...sourceForFact(factSources, id),
      })),
      routes: [...personaRoutes, ...directEvidenceRoutes, ...collectionRoutes],
      personaBehaviors: personas.personas.map((persona) => ({
        personaId: persona.id,
        incentives: persona.incentives,
        uncertainties: [],
        biases: persona.biases,
        openingFactIds: persona.opening.releases,
        openingPoints: persona.opening.points,
        refusalRules: [
          {
            id: `${persona.id}-fallback`,
            trigger: "No authored route matches the student's cue-equivalent request.",
            responseBoundary: personas.fallback_rule,
          },
        ],
      })),
      calibrationAnchors: calibrations.map((calibration, index) => {
        const document = loaded.filesByDocumentId.get(calibrationDocumentIds[index]!);
        if (document === undefined) throw new Error("Calibration document is missing");
        return {
          class: calibrationClass[calibration.rating],
          artifactDigest: document.digest,
          rationale: calibration.evaluator_rationale,
        };
      }),
      nonExhaustiveOutcomeFamilies: boundaries.defensible_response_families_non_exhaustive.map(
        (family) => ({
          id: family.id,
          title: family.response,
          warrantingConditions: [family.can_be_effective_when],
          disqualifyingConditions: boundaries.unacceptable_outcomes.map(({ text }) => text),
          nonExhaustive: true,
        }),
      ),
      authoredRisks: anchors.case_specific_traps,
      successStandard: boundaries.minimum_decision_standard.join(" "),
      evidenceBehaviors: evidence.entries.map((entry) => {
        const asset = evidenceAssets.get(entry.id);
        return {
          evidenceSourceId: entry.id,
          availability: entry.availability.replaceAll("_", "-"),
          outcomeClass: entry.outcome_class,
          authoritativeFactIds: entry.releases,
          requestCues: entry.request_intents ?? [],
          limitations: entry.limitations ?? [],
          ...(entry.collection_route === undefined ? {} : { collectionRouteId: entry.collection_route }),
          ...(entry.reason === undefined ? {} : { unavailableReason: entry.reason }),
          ...(entry.student_visible_sampling_frame === undefined
            ? {}
            : { studentVisibleSamplingFrame: entry.student_visible_sampling_frame }),
          ...(asset === undefined
            ? {}
            : {
                asset: {
                  sourcePath: asset.relativePath,
                  mediaType: mediaType(asset.relativePath),
                  byteLength: asset.byteLength,
                  digest: asset.digest,
                },
              }),
        };
      }),
      economics: {
        currency: economics.currency,
        fixedInputs: Object.entries(economics.fixed_inputs).map(([id, input]) => {
          if (typeof input !== "object") {
            const unit = economicUnit(id, economics.currency);
            return { id, value: input, ...(unit === undefined ? {} : { unit }) };
          }
          const unit = economicUnit(id, economics.currency);
          return {
            id,
            value: input.value,
            ...(unit === undefined ? {} : { unit }),
            ...(input.fact_id === undefined ? {} : { factId: input.fact_id }),
            ...(input.evidence_class === undefined ? {} : { evidenceClass: input.evidence_class }),
          };
        }),
        measurableOutcomes: Object.entries(economics.measurable_after_collection).map(
          ([id, outcome]) => ({
            id,
            value: outcome.value,
            ...(outcome.calculation === undefined ? {} : { calculation: outcome.calculation }),
            ...(outcome.caveat === undefined ? {} : { caveat: outcome.caveat }),
            ...(outcome.evidence_id === undefined
              ? {}
              : { evidenceSourceId: outcome.evidence_id }),
          }),
        ),
        studentOwnedInputs: economics.student_owned_inputs,
        calculationRules: economics.calculation_rules,
        authorNote: economics.author_note,
      },
      sourcePins: [
        {
          id: "approved-scope",
          source: "Approved Volta product contract",
          revision: sourcePins.approved_scope.digest,
          artifacts: [],
        },
        {
          id: "ai-lab",
          source: sourcePins.ai_lab.repository_path,
          revision: sourcePins.ai_lab.commit,
          artifacts: sourcePins.ai_lab.files.map((locator) => ({ locator })),
        },
        {
          id: "volta-intelligence",
          source: sourcePins.volta_intelligence.repository_path,
          revision: sourcePins.volta_intelligence.commit,
          artifacts: sourcePins.volta_intelligence.articles.map((article) => ({
            locator: article.id,
            digest: `sha256:${article.content_sha256}`,
          })),
        },
      ],
      authoringProvenance: {
        path:
          sourcePins.case_origin.type === "original_from_blank"
            ? "blank"
            : "sanitized-reference-assisted",
        studentDisclosure: "simulated",
        liveSourceAccessRequired: false,
        rawSourceMaterialPresent: sourcePins.case_origin.real_client_material_used,
        sourceDocumentDigests: [
          { id: "assembly-contract", digest: loaded.assemblyDigest },
          { id: "case-authoring", digest: previewDigest(caseAuthoringContent) },
          ...[...loaded.filesByDocumentId.entries()]
            .filter(([id]) => id !== "case")
            .map(([id, file]) => ({ id, digest: file.digest })),
        ],
      },
      outOfUniverse: { studentMessage: caseFile.out_of_universe.message },
    },
    requirementsSnapshot: {
      source: `${requirements.snapshot_id}; ${requirements.requirements.length} of ${requirements.source_catalog_count} requirements selected`,
      sourceDigest: requirementsFile.digest,
      capturedAt: validationRecord.validated_at,
    },
    methodologySnapshot: {
      source: `AI Lab ${sourcePins.ai_lab.commit}; Volta Intelligence ${sourcePins.volta_intelligence.commit}`,
      sourceDigest: methodologyFile.digest,
      capturedAt: validationRecord.validated_at,
    },
    approvedBy: caseFile.publication.approved_by,
    approvedAt: caseFile.publication.approved_at,
  });

  return source;
}

export async function importCaseDirectory(caseRoot: string): Promise<CaseImportResult> {
  const loaded = await loadCaseAssembly(caseRoot);
  const source = await normalizeCase(loaded);
  const digests = createPreviewDigests(source);
  const manifestContent = {
    caseId: source.visible.caseId,
    versionLabel: source.visible.versionLabel,
    visibleBundleDigest: digests.visibleBundleDigest,
    files: source.visible.studentAssets ?? [],
  };
  const studentBundleManifest: StudentBundleManifest = {
    ...manifestContent,
    manifestDigest: previewDigest(manifestContent),
  };

  const publicationBlockers: string[] = [];
  if (source.status !== "approved") {
    publicationBlockers.push("The exact case version has no explicit approval.");
  }
  const caseDocument = CaseFileSchema.parse(normalizedDocument(loaded, "case"));
  if (source.status === "approved") {
    if (caseDocument.publication.visible_bundle_sha256 !== digests.visibleBundleDigest) {
      publicationBlockers.push("The recorded visible bundle digest does not match the assembled case.");
    }
    if (caseDocument.publication.protected_package_sha256 !== digests.protectedPackageDigest) {
      publicationBlockers.push("The recorded protected package digest does not match the assembled case.");
    }
  }

  return {
    source,
    digests,
    studentBundleManifest,
    publicationEligible: publicationBlockers.length === 0,
    publicationBlockers,
  };
}
