import { describe, expect, it } from "vitest";

import {
  authenticateCliToken,
  CredentialDeniedError,
  digestSecret,
  exchangePairingCode,
  issuePairingCode,
  revokeCliToken,
  type ActiveCliToken,
  type CliTokenRecord,
  type CredentialStore,
  type PairingCodeRecord,
} from "../src/index.js";

const PEPPER = "test-only-pepper-with-at-least-32-characters";
const NOW = new Date("2026-09-04T12:00:00.000Z");
const CODE = "pairing-code-1234567890";
const TOKEN = "cli-token-abcdefghijklmnopqrstuvwxyz-123456";

class MemoryCredentialStore implements CredentialStore {
  readonly pairingCodes = new Map<string, PairingCodeRecord & { consumedAt?: Date }>();
  readonly tokens = new Map<string, ActiveCliToken>();

  async createPairingCode(record: PairingCodeRecord): Promise<void> {
    this.pairingCodes.set(record.codeDigest, record);
  }

  async consumePairingCodeAndCreateToken(input: {
    readonly assignmentId: string;
    readonly studentGithubUserId: string;
    readonly codeDigest: string;
    readonly now: Date;
    readonly token: CliTokenRecord;
  }): Promise<"issued" | "unavailable"> {
    const record = this.pairingCodes.get(input.codeDigest);
    if (
      record === undefined ||
      record.consumedAt !== undefined ||
      record.expiresAt.getTime() <= input.now.getTime() ||
      record.assignmentId !== input.assignmentId ||
      record.studentGithubUserId !== input.studentGithubUserId ||
      record.blindPolicyVersion !== input.token.blindPolicyVersion
    ) {
      return "unavailable";
    }
    this.pairingCodes.set(input.codeDigest, { ...record, consumedAt: input.now });
    this.tokens.set(input.token.tokenDigest, input.token);
    return "issued";
  }

  async findActiveCliToken(input: {
    readonly assignmentId: string;
    readonly tokenDigest: string;
    readonly now: Date;
  }): Promise<ActiveCliToken | null> {
    const record = this.tokens.get(input.tokenDigest);
    if (
      record === undefined ||
      record.assignmentId !== input.assignmentId ||
      record.expiresAt.getTime() <= input.now.getTime()
    ) {
      return null;
    }
    return record;
  }

  async revokeCliToken(input: {
    readonly assignmentId: string;
    readonly tokenDigest: string;
    readonly revokedAt: Date;
  }): Promise<boolean> {
    const record = this.tokens.get(input.tokenDigest);
    if (record === undefined || record.assignmentId !== input.assignmentId) return false;
    this.tokens.set(input.tokenDigest, { ...record, revokedAt: input.revokedAt });
    return true;
  }
}

async function pairedStore(options: { pairingTtlMs?: number; tokenTtlMs?: number } = {}) {
  const store = new MemoryCredentialStore();
  await issuePairingCode(store, {
    id: "pair-1",
    assignmentId: "assignment-a",
    studentGithubUserId: "101",
    blindPolicyVersion: 1,
    ttlMs: options.pairingTtlMs ?? 60_000,
    pepper: PEPPER,
    now: NOW,
    generateSecret: () => CODE,
  });
  return { store, tokenTtlMs: options.tokenTtlMs ?? 3_600_000 };
}

async function exchange(store: MemoryCredentialStore, tokenTtlMs = 3_600_000) {
  return exchangePairingCode(store, {
    tokenId: "token-1",
    assignmentId: "assignment-a",
    studentGithubUserId: "101",
    code: CODE,
    blindPolicyVersion: 1,
    tokenTtlMs,
    pepper: PEPPER,
    now: new Date(NOW.getTime() + 10_000),
    generateSecret: () => TOKEN,
  });
}

describe("CLI pairing and tokens", () => {
  it("returns each plaintext secret once and stores only purpose-separated digests", async () => {
    const { store } = await pairedStore();
    const issued = await exchange(store);

    expect(issued.token).toBe(TOKEN);
    expect([...store.pairingCodes.keys()]).toEqual([
      digestSecret(CODE, PEPPER, "pairing-code"),
    ]);
    expect([...store.tokens.keys()]).toEqual([digestSecret(TOKEN, PEPPER, "cli-token")]);
    expect(JSON.stringify([...store.pairingCodes.values(), ...store.tokens.values()])).not.toContain(
      TOKEN,
    );
    expect(digestSecret(CODE, PEPPER, "pairing-code")).not.toBe(
      digestSecret(CODE, PEPPER, "cli-token"),
    );
  });

  it("rejects expired and reused pairing codes", async () => {
    const expired = await pairedStore({ pairingTtlMs: 30_000 });
    await expect(
      exchangePairingCode(expired.store, {
        tokenId: "token-expired",
        assignmentId: "assignment-a",
        studentGithubUserId: "101",
        code: CODE,
        blindPolicyVersion: 1,
        tokenTtlMs: 60_000,
        pepper: PEPPER,
        now: new Date(NOW.getTime() + 30_001),
        generateSecret: () => TOKEN,
      }),
    ).rejects.toBeInstanceOf(CredentialDeniedError);

    const current = await pairedStore();
    await exchange(current.store);
    await expect(exchange(current.store)).rejects.toBeInstanceOf(CredentialDeniedError);
    expect(current.store.tokens.size).toBe(1);
  });

  it("rejects pairing-code replay across assignments and identities", async () => {
    const { store } = await pairedStore();
    await expect(
      exchangePairingCode(store, {
        tokenId: "token-cross-assignment",
        assignmentId: "assignment-b",
        studentGithubUserId: "101",
        code: CODE,
        blindPolicyVersion: 1,
        tokenTtlMs: 60_000,
        pepper: PEPPER,
        now: new Date(NOW.getTime() + 1_000),
        generateSecret: () => TOKEN,
      }),
    ).rejects.toBeInstanceOf(CredentialDeniedError);
    await expect(
      exchangePairingCode(store, {
        tokenId: "token-wrong-student",
        assignmentId: "assignment-a",
        studentGithubUserId: "999",
        code: CODE,
        blindPolicyVersion: 1,
        tokenTtlMs: 60_000,
        pepper: PEPPER,
        now: new Date(NOW.getTime() + 1_000),
        generateSecret: () => TOKEN,
      }),
    ).rejects.toBeInstanceOf(CredentialDeniedError);
  });

  it("accepts only an active token for its assignment and current blind-policy version", async () => {
    const { store } = await pairedStore();
    await exchange(store);
    await expect(
      authenticateCliToken(store, {
        assignmentId: "assignment-a",
        token: TOKEN,
        pepper: PEPPER,
        expectedBlindPolicyVersion: 1,
        now: new Date(NOW.getTime() + 20_000),
      }),
    ).resolves.toEqual({
      assignmentId: "assignment-a",
      studentGithubUserId: "101",
      blindPolicyVersion: 1,
    });
    await expect(
      authenticateCliToken(store, {
        assignmentId: "assignment-b",
        token: TOKEN,
        pepper: PEPPER,
        expectedBlindPolicyVersion: 1,
        now: new Date(NOW.getTime() + 20_000),
      }),
    ).rejects.toBeInstanceOf(CredentialDeniedError);
    await expect(
      authenticateCliToken(store, {
        assignmentId: "assignment-a",
        token: TOKEN,
        pepper: PEPPER,
        expectedBlindPolicyVersion: 2,
        now: new Date(NOW.getTime() + 20_000),
      }),
    ).rejects.toBeInstanceOf(CredentialDeniedError);
  });

  it("rejects expired and revoked tokens on the next request", async () => {
    const { store } = await pairedStore({ tokenTtlMs: 60_000 });
    await exchange(store, 60_000);
    await expect(
      authenticateCliToken(store, {
        assignmentId: "assignment-a",
        token: TOKEN,
        pepper: PEPPER,
        expectedBlindPolicyVersion: 1,
        now: new Date(NOW.getTime() + 70_001),
      }),
    ).rejects.toBeInstanceOf(CredentialDeniedError);

    await revokeCliToken(store, {
      assignmentId: "assignment-a",
      token: TOKEN,
      pepper: PEPPER,
      revokedAt: new Date(NOW.getTime() + 30_000),
    });
    await expect(
      authenticateCliToken(store, {
        assignmentId: "assignment-a",
        token: TOKEN,
        pepper: PEPPER,
        expectedBlindPolicyVersion: 1,
        now: new Date(NOW.getTime() + 40_000),
      }),
    ).rejects.toBeInstanceOf(CredentialDeniedError);
  });
});
