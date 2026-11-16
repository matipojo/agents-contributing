import { test } from "node:test";
import assert from "node:assert/strict";

test("a config that lists only help the runner cannot do says so, and reads no repository", async () => {
  const { pick } = await import("../src/runner/flow.ts");
  const { GitHub } = await import("../src/runner/github.ts");
  const { loadConfig } = await import("../src/balance/config.ts");
  const gh = new GitHub(null);
  gh.request = async () => { throw new Error("GitHub must not be asked"); };
  const cfg = { ...loadConfig("templates/contributor.yml"), targets: { repos: ["owner/repo"], topics: [] }, help_types: ["reproduce", "triage", "tests", "docs"] };
  const found = await pick({ cfg, gh, login: "me", runnerRepo: null, vendor: "test", dryRun: true, forced: false, notes: [] });
  assert.equal(found.task, undefined);
  assert.match(found.skipped.all ?? "", /cannot do yet \(reproduce, triage, tests, docs\)\. It does: audit, pr, review\./);
});

test("the contributor template lists help the runner can do", async () => {
  const { loadConfig } = await import("../src/balance/config.ts");
  const { SUPPORTED_TYPES } = await import("../src/runner/tasks.ts");
  const listed = loadConfig("templates/contributor.yml").help_types;
  assert.ok(listed.some((t) => (SUPPORTED_TYPES as readonly string[]).includes(t)), "following the template must not mean contributing nothing");
});
