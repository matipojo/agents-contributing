import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the runner workflow takes the tools by commit, never by branch", () => {
  const workflow = readFileSync("templates/runner/.github/workflows/contribute.yml", "utf8");
  assert.match(workflow, /TOOLS_REF: "__TOOLS_REF__"/);
  assert.ok(!/git clone[^\n]*agents-contributing/.test(workflow));
  assert.match(readFileSync("skills/join-as-contributor/setup-runner.sh", "utf8"), /s\/__TOOLS_REF__\//);
});
