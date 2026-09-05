import { createHash } from "node:crypto";
import {
  CollaboratorPermissionSchema,
  CommitSchema,
  DigestSchema,
  GitHubLoginSchema,
  GitHubUserIdSchema,
  RepositoryNameSchema,
  RepositoryOwnerSchema,
  StudentBundleMaterializationSchema,
  type CollaboratorPermission,
  type ProvisioningFailureCode,
} from "./types.js";
import { z } from "zod";

export const RepositoryIdentitySchema = z
  .object({ owner: RepositoryOwnerSchema, name: RepositoryNameSchema })
  .strict();
export type RepositoryIdentity = z.infer<typeof RepositoryIdentitySchema>;

export const CreateRepositoryRequestSchema = z
  .object({
    owner: RepositoryOwnerSchema,
    name: RepositoryNameSchema,
    private: z.literal(true),
    templateCommit: CommitSchema,
    studentBundleDigest: DigestSchema,
    studentMaterialization: StudentBundleMaterializationSchema,
  })
  .strict();
export type CreateRepositoryRequest = z.infer<typeof CreateRepositoryRequestSchema>;

export const RepositoryReadbackSchema = z
  .object({
    providerRepositoryId: z.string().regex(/^[1-9][0-9]*$/),
    owner: RepositoryOwnerSchema,
    name: RepositoryNameSchema,
    private: z.boolean(),
    templateCommit: CommitSchema,
    materializedCommit: CommitSchema,
    studentBundleDigest: DigestSchema,
    studentManifestDigest: DigestSchema,
    materializedFiles: z.array(
      z
        .object({
          path: z.string().min(1),
          byteLength: z.number().int().nonnegative(),
          digest: DigestSchema,
        })
        .strict(),
    ),
    collaborators: z.array(
      z
        .object({
          githubUserId: GitHubUserIdSchema,
          login: GitHubLoginSchema,
          permission: CollaboratorPermissionSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type RepositoryReadback = z.infer<typeof RepositoryReadbackSchema>;

export const InvitationReadbackSchema = z
  .object({
    invitationId: z.string().min(1).max(120),
    githubUserId: GitHubUserIdSchema,
    login: GitHubLoginSchema,
    permission: CollaboratorPermissionSchema,
    state: z.enum(["pending", "accepted"]),
  })
  .strict();
export type InvitationReadback = z.infer<typeof InvitationReadbackSchema>;

export type ProviderLookup<T> =
  | { readonly status: "found"; readonly value: T }
  | { readonly status: "authoritative-absent" }
  | { readonly status: "unknown" };

export interface GitHubProvisioningAdapter {
  resolveCurrentLogin(githubUserId: string): Promise<string>;
  findRepository(identity: RepositoryIdentity): Promise<ProviderLookup<RepositoryReadback>>;
  createRepository(request: CreateRepositoryRequest): Promise<RepositoryReadback>;
  inviteCollaborator(
    identity: RepositoryIdentity,
    collaborator: { readonly githubUserId: string; readonly login: string; readonly permission: "push" },
  ): Promise<InvitationReadback>;
  readInvitation(
    identity: RepositoryIdentity,
    githubUserId: string,
  ): Promise<ProviderLookup<InvitationReadback>>;
}

export class GitHubAdapterError extends Error {
  constructor(readonly code: ProvisioningFailureCode) {
    super(code);
  }
}

interface MockOptions {
  readonly logins: Readonly<Record<string, string>>;
  readonly createTimeoutAfterSuccessOnce?: boolean;
  readonly invitationFailureOnce?: boolean;
  readonly invitationTimeoutAfterSuccessOnce?: boolean;
  readonly materializedCommit?: string;
  readonly sensitiveFailureText?: string;
}

export class MockGitHubProvisioningAdapter implements GitHubProvisioningAdapter {
  readonly #logins: Readonly<Record<string, string>>;
  readonly #repositories = new Map<string, RepositoryReadback>();
  readonly #invitations = new Map<string, InvitationReadback>();
  readonly #sensitiveFailureText: string | undefined;
  readonly #materializedCommit: string | undefined;
  #createTimeoutRemaining: boolean;
  #invitationFailureRemaining: boolean;
  #invitationTimeoutRemaining: boolean;
  #ambiguousInvitationReadbackRemaining = false;
  #unknownRepositoryLookupRemaining = false;
  #unknownInvitationLookupRemaining = false;
  #nextRepositoryId = 1000;
  #nextInvitationId = 2000;
  createCalls = 0;
  inviteCalls = 0;
  repositoryLookupCalls = 0;
  invitationLookupCalls = 0;
  loginLookupCalls = 0;
  readonly capturedCreateRequests: CreateRepositoryRequest[] = [];

  constructor(options: MockOptions) {
    this.#logins = options.logins;
    this.#createTimeoutRemaining = options.createTimeoutAfterSuccessOnce ?? false;
    this.#invitationFailureRemaining = options.invitationFailureOnce ?? false;
    this.#invitationTimeoutRemaining = options.invitationTimeoutAfterSuccessOnce ?? false;
    this.#sensitiveFailureText = options.sensitiveFailureText;
    this.#materializedCommit = options.materializedCommit;
  }

  async resolveCurrentLogin(githubUserId: string): Promise<string> {
    this.loginLookupCalls += 1;
    GitHubUserIdSchema.parse(githubUserId);
    return GitHubLoginSchema.parse(this.#logins[githubUserId]);
  }

  async findRepository(identity: RepositoryIdentity): Promise<ProviderLookup<RepositoryReadback>> {
    this.repositoryLookupCalls += 1;
    const parsed = RepositoryIdentitySchema.parse(identity);
    if (this.#unknownRepositoryLookupRemaining) {
      this.#unknownRepositoryLookupRemaining = false;
      return { status: "unknown" };
    }
    const repository = this.#repositories.get(this.#key(parsed));
    return repository === undefined
      ? { status: "authoritative-absent" }
      : { status: "found", value: structuredClone(repository) };
  }

  async createRepository(input: CreateRepositoryRequest): Promise<RepositoryReadback> {
    const request = CreateRepositoryRequestSchema.parse(input);
    this.createCalls += 1;
    this.capturedCreateRequests.push(structuredClone(request));
    const key = this.#key(request);
    if (this.#repositories.has(key)) throw new GitHubAdapterError("repository-create-failed");
    const repository = RepositoryReadbackSchema.parse({
      providerRepositoryId: String(this.#nextRepositoryId++),
      owner: request.owner,
      name: request.name,
      private: request.private,
      templateCommit: request.templateCommit,
      materializedCommit:
        this.#materializedCommit ??
        createHash("sha1").update(JSON.stringify(request), "utf8").digest("hex"),
      studentBundleDigest: request.studentBundleDigest,
      studentManifestDigest: request.studentMaterialization.manifestDigest,
      materializedFiles: request.studentMaterialization.files.map(
        ({ path, byteLength, digest }) => ({ path, byteLength, digest }),
      ),
      collaborators: [],
    });
    this.#repositories.set(key, repository);
    if (this.#createTimeoutRemaining) {
      this.#createTimeoutRemaining = false;
      const error = new GitHubAdapterError("repository-create-timeout");
      if (this.#sensitiveFailureText !== undefined) error.message = this.#sensitiveFailureText;
      throw error;
    }
    return structuredClone(repository);
  }

  async inviteCollaborator(
    identity: RepositoryIdentity,
    collaborator: { readonly githubUserId: string; readonly login: string; readonly permission: "push" },
  ): Promise<InvitationReadback> {
    const parsedIdentity = RepositoryIdentitySchema.parse(identity);
    GitHubUserIdSchema.parse(collaborator.githubUserId);
    GitHubLoginSchema.parse(collaborator.login);
    this.inviteCalls += 1;
    if (this.#invitationFailureRemaining) {
      this.#invitationFailureRemaining = false;
      const error = new GitHubAdapterError("invitation-failed");
      if (this.#sensitiveFailureText !== undefined) error.message = this.#sensitiveFailureText;
      throw error;
    }
    const invitation = InvitationReadbackSchema.parse({
      invitationId: String(this.#nextInvitationId++),
      githubUserId: collaborator.githubUserId,
      login: collaborator.login,
      permission: collaborator.permission,
      state: "pending",
    });
    this.#invitations.set(this.#invitationKey(parsedIdentity, collaborator.githubUserId), invitation);
    if (this.#invitationTimeoutRemaining) {
      this.#invitationTimeoutRemaining = false;
      throw new GitHubAdapterError("invitation-timeout");
    }
    return structuredClone(invitation);
  }

  async readInvitation(
    identity: RepositoryIdentity,
    githubUserId: string,
  ): Promise<ProviderLookup<InvitationReadback>> {
    this.invitationLookupCalls += 1;
    const parsedIdentity = RepositoryIdentitySchema.parse(identity);
    GitHubUserIdSchema.parse(githubUserId);
    if (this.#ambiguousInvitationReadbackRemaining) {
      this.#ambiguousInvitationReadbackRemaining = false;
      return { status: "unknown" };
    }
    if (this.#unknownInvitationLookupRemaining) {
      this.#unknownInvitationLookupRemaining = false;
      return { status: "unknown" };
    }
    const invitation = this.#invitations.get(this.#invitationKey(parsedIdentity, githubUserId));
    return invitation === undefined
      ? { status: "authoritative-absent" }
      : { status: "found", value: structuredClone(invitation) };
  }

  acceptInvitation(identity: RepositoryIdentity, githubUserId: string): void {
    const parsedIdentity = RepositoryIdentitySchema.parse(identity);
    const key = this.#invitationKey(parsedIdentity, githubUserId);
    const invitation = this.#invitations.get(key);
    if (invitation === undefined) throw new Error("Invitation not found");
    const accepted = InvitationReadbackSchema.parse({ ...invitation, state: "accepted" });
    this.#invitations.set(key, accepted);
    const repository = this.#repositories.get(this.#key(parsedIdentity));
    if (repository === undefined) throw new Error("Repository not found");
    this.#repositories.set(
      this.#key(parsedIdentity),
      RepositoryReadbackSchema.parse({
        ...repository,
        collaborators: [
          ...repository.collaborators.filter(
            ({ githubUserId: id }) => id !== githubUserId,
          ),
          {
            githubUserId,
            login: accepted.login,
            permission: accepted.permission,
          },
        ],
      }),
    );
  }

  replaceRepositoryReadback(
    identity: RepositoryIdentity,
    changes: Partial<RepositoryReadback>,
  ): void {
    const parsed = RepositoryIdentitySchema.parse(identity);
    const key = this.#key(parsed);
    const repository = this.#repositories.get(key);
    if (repository === undefined) throw new Error("Repository not found");
    this.#repositories.set(key, RepositoryReadbackSchema.parse({ ...repository, ...changes }));
  }

  replaceCollaboratorPermission(
    identity: RepositoryIdentity,
    githubUserId: string,
    permission: CollaboratorPermission,
  ): void {
    const parsed = RepositoryIdentitySchema.parse(identity);
    const key = this.#key(parsed);
    const repository = this.#repositories.get(key);
    if (repository === undefined) throw new Error("Repository not found");
    this.#repositories.set(
      key,
      RepositoryReadbackSchema.parse({
        ...repository,
        collaborators: repository.collaborators.map((collaborator) =>
          collaborator.githubUserId === githubUserId
            ? { ...collaborator, permission }
            : collaborator,
        ),
      }),
    );
  }

  replaceInvitationReadback(
    identity: RepositoryIdentity,
    githubUserId: string,
    changes: Partial<InvitationReadback>,
  ): void {
    const parsed = RepositoryIdentitySchema.parse(identity);
    const key = this.#invitationKey(parsed, githubUserId);
    const invitation = this.#invitations.get(key);
    if (invitation === undefined) throw new Error("Invitation not found");
    this.#invitations.set(
      key,
      InvitationReadbackSchema.parse({ ...invitation, ...changes }),
    );
  }

  removeInvitationReadback(identity: RepositoryIdentity, githubUserId: string): void {
    const parsed = RepositoryIdentitySchema.parse(identity);
    this.#invitations.delete(this.#invitationKey(parsed, githubUserId));
  }

  failNextInvitationReadbackAsAmbiguous(): void {
    this.#ambiguousInvitationReadbackRemaining = true;
  }

  makeNextRepositoryLookupUnknown(): void {
    this.#unknownRepositoryLookupRemaining = true;
  }

  makeNextInvitationLookupUnknown(): void {
    this.#unknownInvitationLookupRemaining = true;
  }

  #key(identity: RepositoryIdentity): string {
    return `${identity.owner.toLowerCase()}/${identity.name.toLowerCase()}`;
  }

  #invitationKey(identity: RepositoryIdentity, githubUserId: string): string {
    return `${this.#key(identity)}:${githubUserId}`;
  }
}
