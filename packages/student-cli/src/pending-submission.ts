import { ArtifactSnapshotSchema, SubmissionDraftSchema } from "@volta-sim/contracts";
import { z } from "zod";

import {
  readOptionalControlJson,
  removeControlFile,
  writeControlJson,
} from "./control-files.js";
import type { StudentServiceRequest } from "./types.js";

export const FIXED_PENDING_SUBMISSION_PATH = ".volta-sim/pending-submission.json";

const ObjectIdSchema = z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
const PendingSubmissionSchema = z
  .object({
    version: z.literal(1),
    request: z
      .object({
        kind: z.literal("submit"),
        operationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/),
        draft: SubmissionDraftSchema,
        artifacts: z.array(ArtifactSnapshotSchema).max(50),
        repository: z
          .object({
            repositorySlug: z.string().min(3).max(300),
            commitSha: ObjectIdSchema,
            sessionIgnoreBlobId: ObjectIdSchema,
            selectedBlobs: z
              .array(z.object({ path: z.string().min(1).max(500), objectId: ObjectIdSchema }).strict())
              .max(50),
          })
          .strict(),
        mode: z.enum(["build", "pilot", "buy", "no-build", "data-collection"]),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ request }, context) => {
    if (
      request.mode === "no-build" &&
      (request.artifacts.length !== 0 || request.repository.selectedBlobs.length !== 0)
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "No-build cannot carry artifacts" });
    }
  });

export async function readPendingSubmission(
  assignmentRoot: string,
): Promise<Extract<StudentServiceRequest, { kind: "submit" }> | undefined> {
  const value = await readOptionalControlJson(assignmentRoot, FIXED_PENDING_SUBMISSION_PATH);
  if (value === undefined) return undefined;
  try {
    return PendingSubmissionSchema.parse(value).request;
  } catch {
    throw new Error("The pending submission record is invalid. Preserve it and ask Volta staff for help");
  }
}

export async function writePendingSubmission(
  assignmentRoot: string,
  request: Extract<StudentServiceRequest, { kind: "submit" }>,
): Promise<void> {
  await writeControlJson(
    assignmentRoot,
    FIXED_PENDING_SUBMISSION_PATH,
    PendingSubmissionSchema.parse({ version: 1, request }),
  );
}

export async function removePendingSubmission(assignmentRoot: string): Promise<void> {
  await removeControlFile(assignmentRoot, FIXED_PENDING_SUBMISSION_PATH);
}
