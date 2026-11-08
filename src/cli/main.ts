#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { main as balance } from "./check-balance.ts";
import { main as provider } from "./provider.ts";
import { main as run } from "./run.ts";
import { main as validate } from "./validate.ts";

const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string;

const USAGE = `Usage: agents-contributing <command> [arguments]

Commands:
  balance [--spent-usd N] [config]
      Print a JSON decision on unused subscription capacity.
      Exit 0 contribute, 10 skip, 2 unknown or error.
  next [--dry-run] [--force] [config]
      Pick a task and print it for an already-running agent.
      Exit 0 done, 10 nothing to do, 2 error.
  submit <task id> --model <model> [config]
      Check and submit what the agent wrote.
      Exit 0 done, 2 error.
  run [--dry-run] [--force] [config]
      Pick a task, launch the provider's agent, and submit the result.
      Exit 0 done, 10 nothing to do, 2 error.
  validate <path/to/AGENTS-CONTRIBUTING.md>
      Check the file against the spec. Warnings do not fail the run.
      Exit 0 valid, 1 invalid, 2 missing path.
  provider name | ci-install | ci-secret <name|command|help> | ci-env [config]
      Query the configured provider adapter.
      Exit 1 when that provider cannot run in GitHub Actions, or when ci-env's secret is missing.
      Missing secret: run skills/join-as-contributor/setup-runner.sh again.
      Exit 2 when the provider or the subcommand is unknown.

Options:
  --version   Print the package version
  --help      Show this help
`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "--version") {
    console.log(version);
    return 0;
  }
  if (command === undefined || command === "--help") {
    console.log(USAGE);
    return 0;
  }
  switch (command) {
    case "balance":
      return balance(rest);
    case "next":
      return run(["next", ...rest]);
    case "submit":
      return run(["submit", ...rest]);
    case "run":
      return run(rest);
    case "validate":
      return validate(rest);
    case "provider":
      return provider(rest);
    default:
      console.error(`Unknown command "${command}".`);
      console.error(USAGE);
      return 2;
  }
}

/** True when this file is the one node or tsx was started with, including via a symlink. */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
