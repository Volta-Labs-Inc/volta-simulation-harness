import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";

const StableIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

const RelativePathSchema = z.string().min(1).max(500);

const AssemblyDocumentSchema = z
  .object({
    id: StableIdSchema,
    path: RelativePathSchema,
    format: z.enum(["yaml", "markdown", "csv"]),
    visibility: z.enum(["student", "protected"]),
  })
  .strict();

const MappingSchema = z
  .object({
    target_pointer: z.string().min(1).max(500),
    source_document: StableIdSchema,
    source_pointer: z.string().min(1).max(500),
    operation: z.literal("copy"),
  })
  .strict();

const StudentCopySchema = z
  .object({
    source: RelativePathSchema,
    target: RelativePathSchema,
  })
  .strict();

export const AssemblySchema = z
  .object({
    assembly_version: z.literal(1),
    assembly_id: StableIdSchema,
    entrypoint: RelativePathSchema,
    pointer_syntax: z.literal("RFC6901"),
    documents: z.array(AssemblyDocumentSchema).min(1).max(500),
    normalized_mapping: z.array(MappingSchema).min(1).max(1_000),
    student_bundle: z
      .object({
        always_copy: z.array(StudentCopySchema).min(1).max(500),
        released_evidence: z
          .object({
            catalog_document: StableIdSchema,
            id_pointer: z.string().min(1).max(500),
            path_pointer: z.string().min(1).max(500),
            eligibility: z.string().min(1).max(2_000),
            target_pattern: z.string().min(1).max(500),
          })
          .strict(),
        forbidden_roots: z.array(RelativePathSchema).min(1).max(100),
      })
      .strict(),
    asset_validation: z
      .object({
        base_directory: z.literal("."),
        require_relative_paths: z.literal(true),
        reject_parent_traversal: z.literal(true),
        reject_symlinks: z.literal(true),
        require_catalog_entry_for_released_fixture: z.literal(true),
        material_change_requires_new_case_version: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type Assembly = z.infer<typeof AssemblySchema>;
export type AssemblyDocument = z.infer<typeof AssemblyDocumentSchema>;

export interface LoadedCaseFile {
  readonly relativePath: string;
  readonly realRelativePath: string;
  readonly format: AssemblyDocument["format"] | "text";
  readonly text: string;
  readonly byteLength: number;
  readonly digest: `sha256:${string}`;
  readonly parsed: unknown;
}

export interface LoadedAssembly {
  readonly root: string;
  readonly assemblyPath: string;
  readonly assemblyDigest: `sha256:${string}`;
  readonly assembly: Assembly;
  readonly filesByDocumentId: ReadonlyMap<string, LoadedCaseFile>;
  readonly normalized: Readonly<Record<string, unknown>>;
}

function byteDigest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function rejectUnsafeCharacters(value: string, label: string): void {
  const containsUnsafeCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    );
  });
  if (containsUnsafeCharacter) {
    throw new Error(`${label} contains a control or line-separator character`);
  }
}

export function validateRelativeCasePath(value: string, label = "Case path"): string {
  rejectUnsafeCharacters(value, label);
  if (
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a normalized relative path within the case root: ${value}`);
  }
  return value;
}

export function canonicalCasePath(value: string): string {
  return validateRelativeCasePath(value)
    .split("/")
    .map((segment) => segment.normalize("NFKC").toLowerCase())
    .join("/");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function assertNoSymlink(root: string, relativePath: string): Promise<string> {
  const segments = validateRelativeCasePath(relativePath).split("/");
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stats = await lstat(current).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Required case path is unavailable: ${relativePath}: ${message}`);
    });
    if (stats.isSymbolicLink()) {
      throw new Error(`Case paths cannot contain symlinks: ${relativePath}`);
    }
  }
  const resolved = await realpath(current);
  if (!isInside(root, resolved)) {
    throw new Error(`Case path escapes the case root: ${relativePath}`);
  }
  return resolved;
}

export async function resolveCaseRoot(caseRoot: string): Promise<string> {
  const absolute = path.resolve(caseRoot);
  const stats = await lstat(absolute);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("The case root must be a real directory, not a symlink");
  }
  return realpath(absolute);
}

function parseYaml(text: string, relativePath: string): unknown {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `Invalid YAML in ${relativePath}: ${document.errors.map(({ message }) => message).join("; ")}`,
    );
  }
  try {
    return document.toJS({ maxAliasCount: 0 }) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unsafe YAML in ${relativePath}: ${message}`);
  }
}

export function parseCsv(text: string, relativePath: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterClosingQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterClosingQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (afterClosingQuote) {
      if (character === ",") {
        row.push(field);
        field = "";
        afterClosingQuote = false;
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        afterClosingQuote = false;
      } else {
        throw new Error(`Unexpected data after a closing quote in CSV ${relativePath}`);
      }
    } else if (character === '"') {
      if (field.length > 0) throw new Error(`Invalid quote placement in CSV ${relativePath}`);
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error(`Unclosed quoted field in CSV ${relativePath}`);
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  while (rows.at(-1)?.every((value) => value.length === 0)) rows.pop();
  if (
    rows.length === 0 ||
    rows[0]!.length < 2 ||
    rows[0]!.some((heading) => heading.trim().length === 0)
  ) {
    throw new Error(`CSV ${relativePath} needs a comma-delimited header with at least two fields`);
  }
  const width = rows[0]!.length;
  const normalizedHeaders = rows[0]!.map((heading) =>
    heading.normalize("NFKC").trim().toLowerCase(),
  );
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new Error(`CSV ${relativePath} contains duplicate headers`);
  }
  if (rows.some((value) => value.length !== width)) {
    throw new Error(`CSV ${relativePath} contains rows with different column counts`);
  }
  return rows;
}

export async function readCaseFile(
  root: string,
  relativePath: string,
  format: LoadedCaseFile["format"],
): Promise<LoadedCaseFile> {
  const resolved = await assertNoSymlink(root, relativePath);
  const bytes = await readFile(resolved);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Case assets must be valid UTF-8 text: ${relativePath}`);
  }
  let parsed: unknown = text;
  if (format === "yaml") parsed = parseYaml(text, relativePath);
  if (format === "csv") parsed = parseCsv(text, relativePath);
  if (format === "markdown" && text.trim().length === 0) {
    throw new Error(`Markdown asset cannot be empty: ${relativePath}`);
  }
  return {
    relativePath,
    realRelativePath: path.relative(root, resolved).split(path.sep).join("/"),
    format,
    text,
    byteLength: bytes.byteLength,
    digest: byteDigest(bytes),
    parsed,
  };
}

function decodePointer(pointer: string): string[] {
  if (pointer === "/") return [];
  if (!pointer.startsWith("/")) throw new Error(`Invalid RFC 6901 pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((token) => {
      if (/~(?:[^01]|$)/u.test(token)) throw new Error(`Invalid RFC 6901 escape in ${pointer}`);
      const decoded = token.replace(/~1/gu, "/").replace(/~0/gu, "~");
      if (["__proto__", "prototype", "constructor"].includes(decoded)) {
        throw new Error(`Unsafe RFC 6901 token in ${pointer}`);
      }
      return decoded;
    });
}

function readPointer(value: unknown, pointer: string): unknown {
  let current = value;
  for (const token of decodePointer(pointer)) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      throw new Error(`Source pointer does not resolve: ${pointer}`);
    }
    if (!Object.prototype.hasOwnProperty.call(current, token)) {
      throw new Error(`Source pointer does not resolve: ${pointer}`);
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

function writePointer(target: Record<string, unknown>, pointer: string, value: unknown): void {
  const tokens = decodePointer(pointer);
  if (tokens.length === 0) throw new Error("A normalized target cannot replace the assembly root");
  let current = target;
  for (const token of tokens.slice(0, -1)) {
    const existing = current[token];
    if (existing === undefined) {
      const child: Record<string, unknown> = {};
      current[token] = child;
      current = child;
    } else if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
      current = existing as Record<string, unknown>;
    } else {
      throw new Error(`Normalized mapping collides at ${pointer}`);
    }
  }
  const finalToken = tokens.at(-1)!;
  if (Object.prototype.hasOwnProperty.call(current, finalToken)) {
    throw new Error(`Duplicate normalized mapping target: ${pointer}`);
  }
  current[finalToken] = structuredClone(value);
}

function duplicateValues(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort();
}

const REQUIRED_NORMALIZED_MAPPINGS = [
  ["/case", "case", "/"],
  ["/requirements", "requirements", "/"],
  ["/personas", "personas", "/personas"],
  ["/persona_route_resolution", "personas", "/route_resolution"],
  ["/truth", "truth", "/"],
  ["/evidence", "evidence", "/entries"],
  ["/fact_index", "evidence", "/fact_index"],
  ["/collection_routes", "collections", "/rules"],
  ["/collection_route_resolution", "collections", "/route_resolution"],
  ["/collection_fallback", "collections", "/fallback"],
  ["/economics", "economics", "/"],
  ["/evaluation_anchors", "anchors", "/"],
  ["/decision_boundaries", "boundaries", "/"],
  ["/source_pins", "source_pins", "/"],
  ["/route_validation", "route_validation", "/"],
  ["/validation_record", "validation_record", "/"],
  ["/calibrations/effective", "calibration_effective", "/"],
  ["/calibrations/partially_effective", "calibration_partial", "/"],
  ["/calibrations/not_yet_effective", "calibration_not_yet", "/"],
  ["/reference_import/input", "sanitized_reference", "/"],
  ["/reference_import/expected", "sanitized_expected", "/"],
] as const;

function validateRequiredMappings(assembly: Assembly): void {
  if (assembly.normalized_mapping.length !== REQUIRED_NORMALIZED_MAPPINGS.length) {
    throw new Error("The assembly must contain exactly the required normalized mappings");
  }
  const mappingByTarget = new Map(
    assembly.normalized_mapping.map((mapping) => [mapping.target_pointer, mapping]),
  );
  for (const [target, sourceDocument, sourcePointer] of REQUIRED_NORMALIZED_MAPPINGS) {
    const mapping = mappingByTarget.get(target);
    if (
      mapping === undefined ||
      mapping.source_document !== sourceDocument ||
      mapping.source_pointer !== sourcePointer ||
      mapping.operation !== "copy"
    ) {
      throw new Error(
        `Required normalized mapping ${target} must copy ${sourceDocument}${sourcePointer}`,
      );
    }
  }
}

export async function loadCaseAssembly(caseRoot: string): Promise<LoadedAssembly> {
  const root = await resolveCaseRoot(caseRoot);
  const entrypoint = await readCaseFile(root, "case.yaml", "yaml");
  const entrypointValue = z.record(z.unknown()).parse(entrypoint.parsed);
  const assemblyPath = z.string().parse(entrypointValue.assembly_ref);
  validateRelativeCasePath(assemblyPath, "Assembly path");
  const assemblyFile = await readCaseFile(root, assemblyPath, "yaml");
  const assembly = AssemblySchema.parse(assemblyFile.parsed);

  if (assembly.entrypoint !== "case.yaml") {
    throw new Error("The assembly entrypoint must match the securely loaded case.yaml file");
  }
  const duplicateDocumentIds = duplicateValues(assembly.documents.map(({ id }) => id));
  const duplicateDocumentPaths = duplicateValues(assembly.documents.map(({ path: filePath }) => filePath));
  const duplicateTargets = duplicateValues(
    assembly.normalized_mapping.map(({ target_pointer: pointer }) =>
      JSON.stringify(decodePointer(pointer)),
    ),
  );
  if (duplicateDocumentIds.length > 0) {
    throw new Error(`Duplicate assembly document ids: ${duplicateDocumentIds.join(", ")}`);
  }
  if (duplicateDocumentPaths.length > 0) {
    throw new Error(`Duplicate assembly document paths: ${duplicateDocumentPaths.join(", ")}`);
  }
  if (duplicateTargets.length > 0) {
    throw new Error("Duplicate normalized mapping targets are not allowed");
  }
  validateRequiredMappings(assembly);

  const filesByDocumentId = new Map<string, LoadedCaseFile>();
  for (const document of assembly.documents) {
    validateRelativeCasePath(document.path, `Assembly document ${document.id}`);
    filesByDocumentId.set(
      document.id,
      document.path === "case.yaml"
        ? entrypoint
        : await readCaseFile(root, document.path, document.format),
    );
  }

  const normalized: Record<string, unknown> = {};
  for (const mapping of assembly.normalized_mapping) {
    const source = filesByDocumentId.get(mapping.source_document);
    if (source === undefined) {
      throw new Error(`Unknown assembly source document: ${mapping.source_document}`);
    }
    writePointer(normalized, mapping.target_pointer, readPointer(source.parsed, mapping.source_pointer));
  }

  return {
    root,
    assemblyPath,
    assemblyDigest: assemblyFile.digest,
    assembly,
    filesByDocumentId,
    normalized,
  };
}
