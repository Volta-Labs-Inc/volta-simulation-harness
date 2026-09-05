import { z } from "zod";

import { readControlJson, removeControlFile, writeControlJson } from "./control-files.js";

const SessionSchema = z
  .object({
    version: z.literal(1),
    assignmentId: z.string().min(1).max(160),
    token: z.string().min(24).max(500),
    repository: z
      .object({
        slug: z.string().min(3).max(300),
        commitSha: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),
        sessionIgnoreBlobId: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),
      })
      .strict(),
  })
  .strict();

export type StudentSession = z.infer<typeof SessionSchema>;

export async function readStudentSession(
  assignmentRoot: string,
  sessionPath: string,
): Promise<StudentSession> {
  try {
    return SessionSchema.parse(await readControlJson(assignmentRoot, sessionPath));
  } catch {
    throw new Error("No usable session was found. Sign in, then retry");
  }
}

export async function writeStudentSession(
  assignmentRoot: string,
  sessionPath: string,
  session: StudentSession,
): Promise<void> {
  await writeControlJson(assignmentRoot, sessionPath, SessionSchema.parse(session));
}

export async function removeStudentSession(
  assignmentRoot: string,
  sessionPath: string,
): Promise<void> {
  await removeControlFile(assignmentRoot, sessionPath);
}
