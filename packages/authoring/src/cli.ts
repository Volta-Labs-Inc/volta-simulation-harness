#!/usr/bin/env node
import { resolve } from "node:path";
import { ZodError } from "zod";
import { createCaseValidationPreview, importCaseDirectory } from "./importer.js";

function usage(): never {
  process.stderr.write("Usage: volta-case-author validate <case-directory>\n");
  process.exit(2);
}

function errorDetails(error: unknown): string[] {
  if (error instanceof ZodError) {
    return error.issues.map(
      (issue) => `${issue.path.length === 0 ? "case" : issue.path.join(".")}: ${issue.message}`,
    );
  }
  return [error instanceof Error ? error.message : String(error)];
}

const [command, caseDirectory, ...unexpected] = process.argv.slice(2);
if (command !== "validate" || caseDirectory === undefined || unexpected.length > 0) usage();

try {
  const result = await importCaseDirectory(resolve(caseDirectory));
  process.stdout.write(
    `${JSON.stringify(createCaseValidationPreview(result), null, 2)}\n`,
  );
} catch (error) {
  process.stderr.write(`${JSON.stringify({ valid: false, errors: errorDetails(error) }, null, 2)}\n`);
  process.exitCode = 1;
}
