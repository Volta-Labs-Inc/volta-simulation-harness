import { createHmac, randomBytes } from "node:crypto";

const MIN_PAIRING_TTL_MS = 30_000;
const MAX_PAIRING_TTL_MS = 10 * 60_000;
const MIN_TOKEN_TTL_MS = 60_000;
const MAX_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

export interface PairingCodeRecord {
  readonly id: string;
  readonly assignmentId: string;
  readonly studentGithubUserId: string;
  readonly blindPolicyVersion: number;
  readonly codeDigest: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface CliTokenRecord {
  readonly id: string;
  readonly assignmentId: string;
  readonly studentGithubUserId: string;
  readonly blindPolicyVersion: number;
  readonly tokenDigest: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface ActiveCliToken extends CliTokenRecord {
  readonly revokedAt?: Date;
}

export interface CredentialStore {
  createPairingCode(record: PairingCodeRecord): Promise<void>;
  consumePairingCodeAndCreateToken(input: {
    readonly assignmentId: string;
    readonly studentGithubUserId: string;
    readonly codeDigest: string;
    readonly now: Date;
    readonly token: CliTokenRecord;
  }): Promise<"issued" | "unavailable">;
  findActiveCliToken(input: {
    readonly assignmentId: string;
    readonly tokenDigest: string;
    readonly now: Date;
  }): Promise<ActiveCliToken | null>;
  revokeCliToken(input: {
    readonly assignmentId: string;
    readonly tokenDigest: string;
    readonly revokedAt: Date;
  }): Promise<boolean>;
}

export class CredentialDeniedError extends Error {
  readonly code = "CREDENTIAL_DENIED";

  constructor() {
    super("The CLI credential is invalid or unavailable");
    this.name = "CredentialDeniedError";
  }
}

export interface SecretGenerator {
  (byteLength: number): string;
}

const randomSecret: SecretGenerator = (byteLength) => randomBytes(byteLength).toString("base64url");

function requireNumericGithubId(value: string): void {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("GitHub user ID must be a positive integer");
}

function requireTtl(ttlMs: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < minimum || ttlMs > maximum) {
    throw new Error(`${label} TTL is outside the allowed range`);
  }
}

export function digestSecret(
  secret: string,
  pepper: string,
  purpose: "pairing-code" | "cli-token",
): string {
  if (secret.length < 20) throw new Error("Credential secret is too short");
  if (pepper.length < 32) throw new Error("Credential pepper must contain at least 32 characters");
  return createHmac("sha256", pepper).update(`${purpose}\0${secret}`, "utf8").digest("hex");
}

export async function issuePairingCode(
  store: CredentialStore,
  input: {
    readonly id: string;
    readonly assignmentId: string;
    readonly studentGithubUserId: string;
    readonly blindPolicyVersion: number;
    readonly ttlMs: number;
    readonly pepper: string;
    readonly now?: Date;
    readonly generateSecret?: SecretGenerator;
  },
): Promise<{ readonly code: string; readonly expiresAt: Date }> {
  requireNumericGithubId(input.studentGithubUserId);
  requireTtl(input.ttlMs, MIN_PAIRING_TTL_MS, MAX_PAIRING_TTL_MS, "Pairing code");
  if (!Number.isSafeInteger(input.blindPolicyVersion) || input.blindPolicyVersion < 1) {
    throw new Error("Blind policy version must be a positive integer");
  }

  const now = input.now ?? new Date();
  const code = (input.generateSecret ?? randomSecret)(16);
  const expiresAt = new Date(now.getTime() + input.ttlMs);
  await store.createPairingCode({
    id: input.id,
    assignmentId: input.assignmentId,
    studentGithubUserId: input.studentGithubUserId,
    blindPolicyVersion: input.blindPolicyVersion,
    codeDigest: digestSecret(code, input.pepper, "pairing-code"),
    createdAt: now,
    expiresAt,
  });
  return { code, expiresAt };
}

export async function exchangePairingCode(
  store: CredentialStore,
  input: {
    readonly tokenId: string;
    readonly assignmentId: string;
    readonly studentGithubUserId: string;
    readonly code: string;
    readonly blindPolicyVersion: number;
    readonly tokenTtlMs: number;
    readonly pepper: string;
    readonly now?: Date;
    readonly generateSecret?: SecretGenerator;
  },
): Promise<{ readonly token: string; readonly expiresAt: Date }> {
  requireNumericGithubId(input.studentGithubUserId);
  requireTtl(input.tokenTtlMs, MIN_TOKEN_TTL_MS, MAX_TOKEN_TTL_MS, "CLI token");
  if (!Number.isSafeInteger(input.blindPolicyVersion) || input.blindPolicyVersion < 1) {
    throw new Error("Blind policy version must be a positive integer");
  }
  const now = input.now ?? new Date();
  const token = (input.generateSecret ?? randomSecret)(32);
  const expiresAt = new Date(now.getTime() + input.tokenTtlMs);
  const result = await store.consumePairingCodeAndCreateToken({
    assignmentId: input.assignmentId,
    studentGithubUserId: input.studentGithubUserId,
    codeDigest: digestSecret(input.code, input.pepper, "pairing-code"),
    now,
    token: {
      id: input.tokenId,
      assignmentId: input.assignmentId,
      studentGithubUserId: input.studentGithubUserId,
      blindPolicyVersion: input.blindPolicyVersion,
      tokenDigest: digestSecret(token, input.pepper, "cli-token"),
      createdAt: now,
      expiresAt,
    },
  });

  if (result !== "issued") throw new CredentialDeniedError();
  return { token, expiresAt };
}

export async function authenticateCliToken(
  store: CredentialStore,
  input: {
    readonly assignmentId: string;
    readonly token: string;
    readonly pepper: string;
    readonly expectedBlindPolicyVersion: number;
    readonly now?: Date;
  },
): Promise<{
  readonly assignmentId: string;
  readonly studentGithubUserId: string;
  readonly blindPolicyVersion: number;
}> {
  const now = input.now ?? new Date();
  const record = await store.findActiveCliToken({
    assignmentId: input.assignmentId,
    tokenDigest: digestSecret(input.token, input.pepper, "cli-token"),
    now,
  });
  if (
    record === null ||
    record.revokedAt !== undefined ||
    record.expiresAt.getTime() <= now.getTime() ||
    record.assignmentId !== input.assignmentId ||
    record.blindPolicyVersion !== input.expectedBlindPolicyVersion
  ) {
    throw new CredentialDeniedError();
  }
  return {
    assignmentId: record.assignmentId,
    studentGithubUserId: record.studentGithubUserId,
    blindPolicyVersion: record.blindPolicyVersion,
  };
}

export async function revokeCliToken(
  store: CredentialStore,
  input: {
    readonly assignmentId: string;
    readonly token: string;
    readonly pepper: string;
    readonly revokedAt?: Date;
  },
): Promise<void> {
  const revoked = await store.revokeCliToken({
    assignmentId: input.assignmentId,
    tokenDigest: digestSecret(input.token, input.pepper, "cli-token"),
    revokedAt: input.revokedAt ?? new Date(),
  });
  if (!revoked) throw new CredentialDeniedError();
}
