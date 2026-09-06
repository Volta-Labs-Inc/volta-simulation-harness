import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { runCli, type CliIo } from "./cli.js";
import { HttpStudentServiceClient } from "./http-client.js";

const LOCAL_MANIFEST_ARGUMENT = "--manifest .volta-sim/local-pilot.json";

/**
 * The exact text a local-pilot student can paste before a command. The pilot
 * does not install a `volta-sim-local` shim, so guidance uses the running
 * script's own path rather than a name that is not on PATH.
 */
export function localCommandName(scriptPath = process.argv[1]): string {
  if (scriptPath === undefined || scriptPath === "") {
    return `volta-sim-local ${LOCAL_MANIFEST_ARGUMENT}`;
  }
  return `node '${scriptPath.replaceAll("'", `'"'"'`)}' ${LOCAL_MANIFEST_ARGUMENT}`;
}

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const LocalPilotManifestSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("volta-sim-local-pilot"),
    assignmentId: z.string().min(1).max(160),
    assignmentRoot: z.string().min(1).max(2_000),
    serviceOrigin: z.string().min(1).max(200),
    issuedAt: z.string().datetime({ offset: true }),
    nonce: z.string().regex(/^[a-f0-9]{32}$/u),
    manifestDigest: DigestSchema,
  })
  .strict();

export interface LocalPilotManifestInput {
  readonly assignmentId: string;
  readonly assignmentRoot: string;
  readonly serviceOrigin: string;
  readonly issuedAt: string;
  readonly nonce: string;
}

export type LocalPilotManifest = z.infer<typeof LocalPilotManifestSchema>;

export interface RunLocalCliOptions {
  readonly cwd?: string;
  readonly io?: CliIo;
  readonly commandName?: string;
}

function manifestContent(input: LocalPilotManifestInput) {
  return {
    version: 1 as const,
    kind: "volta-sim-local-pilot" as const,
    assignmentId: input.assignmentId,
    assignmentRoot: input.assignmentRoot,
    serviceOrigin: input.serviceOrigin,
    issuedAt: input.issuedAt,
    nonce: input.nonce,
  };
}

function digestManifest(input: LocalPilotManifestInput): `sha256:${string}` {
  const serialized = JSON.stringify(manifestContent(input));
  return `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`;
}

function assertLoopbackOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("The local pilot manifest has an invalid service origin");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port === "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("The local pilot manifest must use its generated loopback service origin");
  }
  return url.origin;
}

export function createLocalPilotManifest(input: LocalPilotManifestInput): LocalPilotManifest {
  if (!path.isAbsolute(input.assignmentRoot)) {
    throw new Error("The local pilot assignment path must be absolute");
  }
  assertLoopbackOrigin(input.serviceOrigin);
  return LocalPilotManifestSchema.parse({
    ...manifestContent(input),
    manifestDigest: digestManifest(input),
  });
}

async function readLocalPilotManifest(
  rawManifestPath: string,
  cwd: string,
): Promise<LocalPilotManifest> {
  if (rawManifestPath.trim() === "" || rawManifestPath.length > 2_000) {
    throw new Error("Provide the generated local pilot manifest path");
  }
  const cwdRoot = await fs.promises.realpath(cwd).catch(() => {
    throw new Error("Run the local student command from its generated assignment checkout");
  });
  const manifestPath = path.resolve(cwdRoot, rawManifestPath);
  const status = await fs.promises.lstat(manifestPath).catch(() => {
    throw new Error("The generated local pilot manifest is unavailable");
  });
  if (!status.isFile() || status.isSymbolicLink() || status.size > 20_000) {
    throw new Error("The generated local pilot manifest is unavailable");
  }
  const raw = await fs.promises.readFile(manifestPath, "utf8");
  const parsed = LocalPilotManifestSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) throw new Error("The generated local pilot manifest is invalid");
  const manifest = parsed.data;
  const assignmentRoot = await fs.promises.realpath(manifest.assignmentRoot).catch(() => {
    throw new Error("The generated local pilot assignment checkout is unavailable");
  });
  const expectedManifestPath = path.join(assignmentRoot, ".volta-sim", "local-pilot.json");
  const resolvedManifestPath = await fs.promises.realpath(manifestPath);
  if (
    assignmentRoot !== cwdRoot ||
    resolvedManifestPath !== expectedManifestPath ||
    manifest.manifestDigest !== digestManifest(manifest) ||
    assertLoopbackOrigin(manifest.serviceOrigin) !== manifest.serviceOrigin
  ) {
    throw new Error("The generated local pilot manifest does not match this assignment checkout");
  }
  return manifest;
}

export async function runLocalCli(
  argv: readonly string[],
  options: RunLocalCliOptions = {},
): Promise<number> {
  const io =
    options.io ??
    ({
      writeOut: (value: string) => process.stdout.write(`${value}\n`),
      writeError: (value: string) => process.stderr.write(`${value}\n`),
    } satisfies CliIo);
  try {
    if (argv[0] !== "--manifest" || argv[1] === undefined) {
      throw new Error(
        "Use volta-sim-local --manifest .volta-sim/local-pilot.json <command>",
      );
    }
    const manifest = await readLocalPilotManifest(argv[1], options.cwd ?? process.cwd());
    return runCli(argv.slice(2), {
      assignmentRoot: manifest.assignmentRoot,
      client: new HttpStudentServiceClient(manifest.serviceOrigin),
      commandName: options.commandName ?? localCommandName(),
      io,
    });
  } catch (error) {
    io.writeError(error instanceof Error ? error.message : "The local student command failed");
    return 1;
  }
}
