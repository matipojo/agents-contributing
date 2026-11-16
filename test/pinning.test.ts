import { test } from "node:test";
import assert from "node:assert/strict";

test("the runner says when its own code is old, since it never updates itself", async () => {
  const { staleNote, STALE_DAYS } = await import("../src/runner/policy.ts");
  const at = new Date("2026-10-29T12:00:00Z");
  const daysAgo = (d: number) => new Date(at.getTime() - d * 24 * 3_600_000);
  assert.equal(staleNote(null, at), null, "not a git checkout: nothing to say");
  assert.equal(staleNote(daysAgo(STALE_DAYS), at), null);
  assert.match(staleNote(daysAgo(STALE_DAYS + 1), at) ?? "", /61 days old.*Update the runner/);
});

test("the runner workflow takes the tools and its actions by commit, never by branch or tag", async () => {
  const { readFileSync } = await import("node:fs");
  const workflow = readFileSync("templates/runner/.github/workflows/contribute.yml", "utf8");
  assert.match(workflow, /TOOLS_REF: "__TOOLS_REF__"/, "setup-runner.sh fills in the commit");
  assert.ok(!/git clone[^\n]*agents-contributing/.test(workflow), "no clone of a branch");
  for (const uses of workflow.matchAll(/uses: (\S+)/g)) {
    assert.match(uses[1]!, /@[0-9a-f]{40}$/, `${uses[1]} is pinned to a commit`);
  }
  const setup = readFileSync("skills/join-as-contributor/setup-runner.sh", "utf8");
  assert.match(setup, /s\/__TOOLS_REF__\/\$TOOLS_REF\//);
});
