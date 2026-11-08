#!/usr/bin/env node
/**
 * The agents-contributing command. Each name below is one of the tools in this directory.
 *
 *   agents-contributing balance   [--spent-usd N] [config]     today's check-balance
 *   agents-contributing next      [--dry-run] [--force] [config]
 *   agents-contributing submit    <task id> --model <model> [config]
 *   agents-contributing run       [--dry-run] [--force] [config]
 *   agents-contributing validate  path/to/AGENTS-CONTRIBUTING.md
 *   agents-contributing provider  name | ci-install | ci-secret <field> | ci-env [config]
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { main as balance } from "./check-balance.ts";
import { main as provider } from "./provider.ts";
import { main as run } from "./run.ts";
import { main as validate } from "./validate.ts";

const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string;

const USAGE = `Usage: agents-contributing <command> [arguments]

Commands:
  balance     Decide whether there is unused subscription capacity to donate
  next        Pick a task and print it for an already-running agent
  submit      Check and submit what the agent wrote
  run         Pick a task, launch the provider's agent, and submit the result
  validate    Validate an AGENTS-CONTRIBUTING.md file
  provider    Ask the configured provider's adapter

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
