import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage, type Server } from "node:http";

import { FileBackedMockStudentService, MockServiceError } from "./mock-service.js";
import { createLocalSubmissionRepositoryVerifier } from "./repository.js";
import type { StudentServiceRequest } from "./types.js";

const MAX_REQUEST_BYTES = 1_000_000;
const routes = new Map<string, { readonly method: "GET" | "POST"; readonly kind: StudentServiceRequest["kind"] }>([
  ["/v1/student/pair", { method: "POST", kind: "login" }],
  ["/v1/student/assignment/resume", { method: "GET", kind: "resume" }],
  ["/v1/student/assignment/status", { method: "GET", kind: "status" }],
  ["/v1/student/actions/talk", { method: "POST", kind: "talk" }],
  ["/v1/student/actions/evidence", { method: "POST", kind: "evidence" }],
  ["/v1/student/actions/collect", { method: "POST", kind: "collect" }],
  ["/v1/student/actions/advance", { method: "POST", kind: "advance" }],
  ["/v1/student/reasoning/ledger", { method: "POST", kind: "ledger" }],
  ["/v1/student/reasoning/decision", { method: "POST", kind: "decision" }],
  ["/v1/student/reasoning/estimate", { method: "POST", kind: "estimate" }],
  ["/v1/student/reasoning/requirement", { method: "POST", kind: "requirement" }],
  ["/v1/student/reasoning/claim", { method: "POST", kind: "claim" }],
  ["/v1/student/reasoning/draft", { method: "POST", kind: "draft" }],
  ["/v1/student/reasoning/criterion", { method: "POST", kind: "criterion" }],
  ["/v1/student/reasoning/criterion/remove", { method: "POST", kind: "criterion-remove" }],
  ["/v1/student/reasoning/calculation", { method: "POST", kind: "calculation" }],
  ["/v1/student/reasoning/calculation/remove", { method: "POST", kind: "calculation-remove" }],
  ["/v1/student/checkpoint", { method: "GET", kind: "checkpoint" }],
  ["/v1/student/submission/prepare", { method: "GET", kind: "prepare-submission" }],
  ["/v1/student/review-request", { method: "POST", kind: "review-request" }],
  ["/v1/student/submit", { method: "POST", kind: "submit" }],
  ["/v1/student/logout", { method: "POST", kind: "logout" }],
]);

export interface LocalStudentHttpServiceOptions {
  readonly serviceStateRoot: string;
  readonly statePath: string;
  readonly assignmentRoot?: string;
  readonly port?: number;
  readonly now?: () => Date;
}

export interface RunningLocalStudentHttpService {
  readonly origin: string;
  readonly server: Server;
  close(): Promise<void>;
}

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_REQUEST_BYTES) throw new Error("The local student request is too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function startLocalStudentHttpService(
  options: LocalStudentHttpServiceOptions,
): Promise<RunningLocalStudentHttpService> {
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("The local student service port is invalid");
  }
  const service = new FileBackedMockStudentService(options.serviceStateRoot, options.statePath, {
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.assignmentRoot === undefined ? {} : {
      verifySubmissionRepository: createLocalSubmissionRepositoryVerifier(options.assignmentRoot),
      interviewExportRoot: options.assignmentRoot,
    }),
  });
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
        if (requestUrl.search !== "" || requestUrl.hash !== "") {
          throw new Error("The local student endpoint is unavailable");
        }
        const route = routes.get(requestUrl.pathname);
        if (route === undefined || request.method !== route.method) {
          response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Local student endpoint not found" }));
          return;
        }
        const body = await requestBody(request);
        let input: StudentServiceRequest;
        if (route.method === "GET") {
          if (body !== "") throw new Error("The local student request is invalid");
          input = { kind: route.kind } as StudentServiceRequest;
        } else {
          const parsed = JSON.parse(body) as StudentServiceRequest;
          if (parsed.kind !== route.kind) throw new Error("The local student request is invalid");
          input = parsed;
        }
        const authorization = request.headers.authorization;
        const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
        const result = await service.execute(input, token);
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(400, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(
          JSON.stringify({
            ...(error instanceof MockServiceError ? { code: error.code } : {}),
            error: error instanceof Error ? error.message : "Local student request failed",
          }),
        );
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("The local student service did not bind to loopback");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
