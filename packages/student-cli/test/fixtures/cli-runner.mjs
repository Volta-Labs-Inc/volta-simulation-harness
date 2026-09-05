/* global process */
import { HttpStudentServiceClient, runCli } from "../../dist/index.js";

const serviceOrigin = process.argv[2];
if (serviceOrigin === undefined) throw new Error("test service origin is required");
process.exitCode = await runCli(process.argv.slice(3), {
  assignmentRoot: process.cwd(),
  client: new HttpStudentServiceClient(serviceOrigin),
});
