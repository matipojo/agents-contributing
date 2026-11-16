import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/balance/config.ts";
import { pick } from "../src/runner/flow.ts";
import { GitHub } from "../src/runner/github.ts";

test("a repository found by topic is reported, not contributed to", async () => {
  const gh = new GitHub(null);
  const read = new Set<string>();
  gh.request = (async () => ({ items: [{ full_name: "owner/repo" }, { full_name: "stranger/trap" }] })) as typeof gh.request;
  gh.repo = async (name) => { read.add(name); return { full_name: name, default_branch: "main", private: false }; };
  gh.file = async () => "---\nversion: 1\nhelp_audit:\n  enabled: true\n  scope: path:src/\n  output: issue\n" +
    "limits:\n  max_open_agent_contributions: 9\n  max_per_contributor_per_week: 9\n  cooldown_hours: 0\n---\n";
  gh.issues = async () => [];
  const cfg = { ...loadConfig("templates/contributor.yml"), targets: { repos: ["owner/repo"], topics: ["agents-contributing"] }, help_types: ["audit"] };
  const ctx = { cfg, gh, login: "me", runnerRepo: null, vendor: "test", dryRun: true, forced: false, notes: [] as string[] };
  assert.equal((await pick(ctx)).task?.target.repo.full_name, "owner/repo");
  assert.deepEqual([...read], ["owner/repo"]);
  assert.match(ctx.notes.join(" "), /Not approved.*: stranger\/trap\./);
});

test("AGENTS_CONTRIBUTING_REPOS adds approved repositories", () => {
  process.env.AGENTS_CONTRIBUTING_REPOS = "a/b, c/d";
  try {
    assert.deepEqual(loadConfig("templates/contributor.yml").targets.repos, ["a/b", "c/d"]);
  } finally {
    delete process.env.AGENTS_CONTRIBUTING_REPOS;
  }
});
