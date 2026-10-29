#!/usr/bin/env -S npx tsx
/**
 * Validate an AGENTS-CONTRIBUTING.md file against spec v1.
 *
 * Usage: npx tsx src/cli/validate.ts path/to/AGENTS-CONTRIBUTING.md
 * Exit code 0 when valid, 1 when there are errors. Warnings do not fail.
 */
import { readFileSync } from "node:fs";
import { validateText } from "../spec.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx src/cli/validate.ts path/to/AGENTS-CONTRIBUTING.md");
  process.exit(2);
}

const { errors, warnings } = validateText(readFileSync(file, "utf8"));
for (const w of warnings) console.log(`WARNING: ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);

if (errors.length > 0) {
  console.log(`\nInvalid: ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`\nValid. ${warnings.length} warning(s).`);
