import { createHash } from "node:crypto";
import { z } from "zod";

export const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const CommitSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const GitHubLoginSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/);
export const RepositoryOwnerSchema = GitHubLoginSchema;
export const RepositoryNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}$/);
export const GitHubUserIdSchema = z.string().regex(/^[1-9][0-9]*$/);
const MaxStudentFileCount = 200;
const MaxStudentFileBytes = 5_000_000;
const MaxStudentBundleBytes = 10_000_000;

const StudentFilePathSchema = z.string().superRefine((value, context) => {
  const components = value.split("/");
  const firstComponent = components[0]?.normalize("NFKC").toLocaleLowerCase("en-US");
  const hasForbiddenCodePoint = [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    );
  });
  if (
    value.length === 0 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u.test(value) ||
    value.startsWith("/") ||
    value.includes("\\") ||
    hasForbiddenCodePoint ||
    components.some((component) => component === "" || component === "." || component === "..") ||
    firstComponent === ".private" ||
    firstComponent === "private" ||
    firstComponent === "protected"
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Unsafe student file path" });
  }
});

export const StudentBundleFileSchema = z
  .object({
    path: StudentFilePathSchema,
    mediaType: z.enum([
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json",
      "application/yaml",
    ]),
    byteLength: z.number().int().nonnegative().max(MaxStudentFileBytes),
    digest: DigestSchema,
    content: z.string(),
  })
  .strict()
  .superRefine((file, context) => {
    const bytes = Buffer.from(file.content, "utf8");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (file.byteLength !== bytes.byteLength) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Student file byte length mismatch" });
    }
    if (file.digest !== digest) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Student file digest mismatch" });
    }
  });
export type StudentBundleFile = z.infer<typeof StudentBundleFileSchema>;

export interface MaterializedFileReadback {
  readonly path: string;
  readonly byteLength: number;
  readonly digest: `sha256:${string}`;
}

export function studentManifestDigest(
  files: readonly Pick<StudentBundleFile, "path" | "byteLength" | "digest">[],
): `sha256:${string}` {
  // The alphabetical field order matches the database canonical JSON encoder.
  const manifest = files.map(({ path, byteLength, digest }) => ({ byteLength, digest, path }));
  return `sha256:${createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex")}`;
}

export const StudentBundleMaterializationSchema = z
  .object({
    manifestDigest: DigestSchema,
    files: z.array(StudentBundleFileSchema).min(1).max(MaxStudentFileCount),
  })
  .strict()
  .superRefine((materialization, context) => {
    const paths = materialization.files.map(({ path }) => path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate student file path" });
    }
    if (paths.some((path, index) => index > 0 && paths[index - 1]! >= path)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Student files must be path-sorted" });
    }
    if (materialization.manifestDigest !== studentManifestDigest(materialization.files)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Student manifest digest mismatch" });
    }
    if (
      materialization.files.reduce((total, { byteLength }) => total + byteLength, 0) >
      MaxStudentBundleBytes
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Student bundle byte limit exceeded" });
    }
  });
export type StudentBundleMaterialization = z.infer<typeof StudentBundleMaterializationSchema>;

export const AssignmentProvisioningRequestSchema = z
  .object({
    operationId: z.string().min(1).max(160),
    caseVersionDigest: DigestSchema,
    studentBundleDigest: DigestSchema,
    studentMaterialization: StudentBundleMaterializationSchema,
    templateCommit: CommitSchema,
    studentGithubUserId: GitHubUserIdSchema,
    repositoryOwner: RepositoryOwnerSchema,
  })
  .strict();

export type AssignmentProvisioningRequest = z.infer<
  typeof AssignmentProvisioningRequestSchema
>;

export const ProvisioningStateSchema = z.enum([
  "provisioning",
  "repository_created",
  "invitation_pending",
  "ready",
]);
export type ProvisioningState = z.infer<typeof ProvisioningStateSchema>;

export const CollaboratorPermissionSchema = z.enum([
  "pull",
  "triage",
  "push",
  "maintain",
  "admin",
]);
export type CollaboratorPermission = z.infer<typeof CollaboratorPermissionSchema>;

export const ProvisioningFailureCodeSchema = z.enum([
  "repository-create-timeout",
  "repository-create-failed",
  "repository-readback-invalid",
  "repository-lookup-unknown",
  "repository-scan-dirty",
  "repository-scan-timeout",
  "repository-scan-failed",
  "repository-scan-receipt-invalid",
  "invitation-failed",
  "invitation-timeout",
  "invitation-readback-invalid",
  "invitation-lookup-unknown",
  "provider-error",
]);
export type ProvisioningFailureCode = z.infer<typeof ProvisioningFailureCodeSchema>;

export interface AssignmentRecord {
  readonly assignmentId: string;
  readonly operationId: string;
  readonly requestDigest: `sha256:${string}`;
  readonly caseVersionDigest: `sha256:${string}`;
  readonly studentBundleDigest: `sha256:${string}`;
  readonly studentMaterialization: StudentBundleMaterialization;
  readonly templateCommit: string;
  readonly studentGithubUserId: string;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly state: ProvisioningState;
  readonly providerRepositoryId?: string;
  readonly materializedCommit?: string;
  readonly cleanScanReceipt?: CleanRepositoryScanReceipt;
  readonly readinessScanReceipt?: CleanRepositoryScanReceipt;
  readonly currentLogin?: string;
  readonly invitationId?: string;
  readonly invitationAccepted?: boolean;
  readonly collaboratorPermission?: CollaboratorPermission;
  readonly readyAt?: string;
  readonly failure?: {
    readonly code: ProvisioningFailureCode;
    readonly failedAt: string;
  };
}

export interface CleanRepositoryScanReceipt {
  readonly receiptId: string;
  readonly stage: "pre_invitation" | "pre_ready";
  readonly generation: number;
  readonly assignmentId: string;
  readonly providerRepositoryId: string;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly templateCommit: string;
  readonly materializedCommit: string;
  readonly studentBundleDigest: `sha256:${string}`;
  readonly studentManifestDigest: `sha256:${string}`;
  readonly materializedFilesDigest: `sha256:${string}`;
  readonly repositoryStateDigest: `sha256:${string}`;
  readonly canarySetDigest: `sha256:${string}`;
  readonly scannerVersion: string;
  readonly scannedAt: string;
}

export interface PublishedCaseBinding {
  readonly caseVersionDigest: `sha256:${string}`;
  readonly studentBundleDigest: `sha256:${string}`;
  readonly studentManifestDigest: `sha256:${string}`;
}

export interface ProvisioningConfiguration {
  readonly repositoryOwner: string;
  readonly templateCommit: string;
}

export interface StudentServiceReadiness {
  readonly ready: boolean;
  readonly assignmentId?: string;
  readonly repositoryOwner?: string;
  readonly repositoryName?: string;
}
