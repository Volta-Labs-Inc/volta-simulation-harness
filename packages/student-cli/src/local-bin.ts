#!/usr/bin/env node
import { runLocalCli } from "./local-cli.js";

process.exitCode = await runLocalCli(process.argv.slice(2));
