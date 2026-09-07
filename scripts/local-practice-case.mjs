import fs from "node:fs/promises";
import path from "node:path";
import { importCaseDirectory } from "../packages/authoring/dist/importer.js";
import { readCaseFile } from "../packages/authoring/dist/assembly.js";
import { sha256Digest } from "../packages/core/dist/canonical.js";
import { createHash } from "node:crypto";
import YAML from "yaml";

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export async function loadLocalPracticeCase(directory) {
  const root = await fs.realpath(path.resolve(directory));
  const imported = await importCaseDirectory(root);
  const caseFile = YAML.parse((await readCaseFile(root, "case.yaml", "yaml")).text);
  const collections = YAML.parse((await readCaseFile(root, caseFile.collection_consequences_ref, "yaml")).text);
  const simulatedAt = new Date(collections.clock_start).toISOString();
  const source = JSON.parse(JSON.stringify(imported.source));
  const studentFiles = [];
  const readAsset = async (asset) => {
    const format = asset.sourcePath.endsWith(".csv") ? "csv"
      : asset.sourcePath.endsWith(".yaml") ? "yaml" : "markdown";
    const file = await readCaseFile(root, asset.sourcePath, format);
    if (digest(file.text) !== asset.digest) throw new Error("Case asset changed after validation");
    return file.text;
  };
  const reserved = new Set([".gitignore", "START-HERE.md", "AGENTS.md", "CLAUDE.md", "requirements.json", "results/response.md"]);
  for (const asset of imported.studentBundleManifest.files) {
    if (reserved.has(asset.targetPath) || [".git", ".volta-sim"].includes(asset.targetPath.split("/")[0])) {
      throw new Error("An authored student asset conflicts with a local control file");
    }
    studentFiles.push({ targetPath: asset.targetPath, text: await readAsset(asset) });
  }
  const evidenceText = new Map();
  for (const behavior of source.protected.evidenceBehaviors ?? []) {
    if (behavior.asset && behavior.availability !== "unavailable") {
      evidenceText.set(behavior.evidenceSourceId, await readAsset(behavior.asset));
    }
  }
  // Practice is a separate, explicitly non-assessed snapshot. The authored
  // source and its assessed publication approval are never changed.
  source.status = "approved";
  source.approvedBy = "Local operator: explicit --practice-case invocation (practice only)";
  source.approvedAt = new Date().toISOString();
  source.visible.assessmentUse = "non-assessed-example";
  source.visible.versionLabel = `${source.visible.versionLabel}-local-practice`;
  source.visible.brief = "LOCAL PRACTICE IS ACTIVE. Use the commands in START-HERE.md. Replies are frozen authored answers, with no live AI rendering. This is not an assessed run.\n\n" + source.visible.brief;
  for (const route of source.protected.routes) {
    const released = route.releasedEvidenceIds.map(id => evidenceText.has(id) ? `\n\nReleased document ${id}:\n${evidenceText.get(id)}` : "");
    route.outcome.studentMessage += released.join("");
    if (route.outcome.kind === "partial") route.outcome.studentMessage += `\n\nEvidence limitation: ${route.outcome.limitation}`;
    if (route.consequence.resources.length > 0) route.outcome.studentMessage += `\n\nSimulated resources used: ${route.consequence.resources.map(resource => `${resource.id}: ${resource.amount} ${resource.unit}`).join(", ")}.`;
  }
  for (const behavior of source.protected.evidenceBehaviors ?? []) {
    if (behavior.availability !== "initial") continue;
    source.protected.routes.push({
      id: `local-read-${behavior.evidenceSourceId}`, channel: "evidence", targetId: behavior.evidenceSourceId, priority: 100,
      match: { anyPhrases: ["show", "read", "scope"], allTerms: [], anyTermGroups: [], noneTerms: [] },
      prerequisiteFactIds: [], prerequisiteEvidenceIds: [], releasedEvidenceIds: [behavior.evidenceSourceId],
      consequence: { id: `local-read-${behavior.evidenceSourceId}-result`, time: { amount: 0, unit: "minutes" }, resources: [], evidenceOutcome: "release" },
      outcome: { kind: "release", factIds: behavior.authoritativeFactIds, studentMessage: evidenceText.get(behavior.evidenceSourceId) ?? "Initial evidence is in your starting bundle." },
    });
  }
  return { source, studentFiles, simulatedAt, provenance: { kind: "local-practice-only", authoredCaseDigests: imported.digests, studentManifestDigest: imported.studentBundleManifest.manifestDigest, importedSourceDigest: sha256Digest(imported.source) } };
}
