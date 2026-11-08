#!/usr/bin/env -S npx tsx
/**
 * Validate an AGENTS-CONTRIBUTING.md file against spec v1.
 *
 * Usage: npx tsx src/cli/validate.ts path/to/AGENTS-CONTRIBUTING.md
 * Exit code 0 when valid, 1 when there are errors. Warnings do not fail.
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateText } from "../spec.ts";

export function main(argv: string[]): number {
  const file = argv[0];
  if (!file) {
    console.error("Usage: npx tsx src/cli/validate.ts path/to/AGENTS-CONTRIBUTING.md");
    return 2;
  }

  const { errors, warnings } = validateText(readFileSync(file, "utf8"));
  for (const w of warnings) console.log(`WARNING: ${w}`);
  for (const e of errors) console.log(`ERROR: ${e}`);

  if (errors.length > 0) {
    console.log(`\nInvalid: ${errors.length} error(s), ${warnings.length} warning(s).`);
    return 1;
  }
  console.log(`\nValid. ${warnings.length} warning(s).`);
  return 0;
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

if (invokedDirectly()) process.exit(main(process.argv.slice(2)));
