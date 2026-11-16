import { test } from "node:test";
import assert from "node:assert/strict";

test("a repository found by topic is reported, and contributed to only once approved", async () => {
  const { pick } = await import("../src/runner/flow.ts");
  const { GitHub } = await import("../src/runner/github.ts");
  const { loadConfig } = await import("../src/balance/config.ts");
  const gh = new GitHub(null);
  const read: string[] = [];
  gh.request = (async (_m: string, path: string) => {
    if (path.startsWith("/search/repositories")) return { items: [{ full_name: "owner/repo" }, { full_name: "stranger/trap" }] };
    throw new Error(`unexpected ${path}`);
  }) as typeof gh.request;
  gh.repo = async (name) => { read.push(name); return { full_name: name, default_branch: "main", private: false }; };
  gh.file = async () => "---\nversion: 1\nhelp_audit:\n  enabled: true\n  scope: path:src/\n  output: issue\n" +
    "limits:\n  max_open_agent_contributions: 9\n  max_per_contributor_per_week: 9\n  cooldown_hours: 0\n---\n";
  gh.issues = async () => [];
  const base = { ...loadConfig("templates/contributor.yml"), help_types: ["audit"] };
  const ctx = (targets: typeof base.targets) =>
    ({ cfg: { ...base, targets }, gh, login: "me", runnerRepo: null, vendor: "test", dryRun: true, forced: false, notes: [] as string[] });

  const listed = ctx({ repos: ["owner/repo"], topics: ["agents-contributing"] });
  const found = await pick(listed);
  assert.equal(found.task?.target.repo.full_name, "owner/repo");
  assert.deepEqual([...new Set(read)], ["owner/repo"], "an unapproved repository is not even read");
  assert.match(listed.notes.join(" "), /1 repository asks for help and is not approved: stranger\/trap\./);
  assert.match(listed.notes.join(" "), /run\.ts approve/);

  read.length = 0;
  const none = ctx({ repos: [], topics: ["agents-contributing"] });
  assert.equal((await pick(none)).task, undefined, "nothing approved, nothing contributed");
  assert.deepEqual(read, []);
  assert.match(none.notes.join(" "), /2 repositories ask for help and are not approved: owner\/repo, stranger\/trap\./);

  const open = ctx({ repos: [], topics: ["agents-contributing"], auto_approve: true });
  assert.equal((await pick(open)).task?.target.repo.full_name, "owner/repo", "auto_approve restores contributing by topic");
  assert.deepEqual(open.notes, []);
});

test("approve checks a repository and adds it to targets.repos, keeping the rest of the config", async () => {
  const { approve } = await import("../src/runner/approve.ts");
  const { GitHub } = await import("../src/runner/github.ts");
  const { loadConfig, HOME_REPO } = await import("../src/balance/config.ts");
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const gh = new GitHub(null);
  gh.repo = async (name) => {
    if (name === "gone/repo") throw new Error("GitHub GET /repos/gone/repo: 404 Not Found");
    return { full_name: name, default_branch: "main", private: name === "secret/repo", topics: name === "someone/agents-contributing-runner" ? ["agents-contributing-runner"] : [] };
  };
  gh.file = async (name) => name === "nofile/repo" ? null :
    "---\nversion: 1\nhelp_audit:\n  enabled: true\n  scope: path:src/\n  output: issue\nhelp_pr:\n  enabled: false\n" +
    "limits:\n  max_open_agent_contributions: 9\n  max_per_contributor_per_week: 9\n  cooldown_hours: 0\n---\n";
  const dir = mkdtempSync(join(tmpdir(), "ac-approve-"));
  try {
    // No config yet: the file is created, and keeps the default approval next to the new one.
    const fresh = join(dir, "new", "contributor.yml");
    const first = await approve(gh, ["owner/repo", "nofile/repo", "secret/repo", "someone/agents-contributing-runner", "gone/repo", "not a name"], fresh);
    assert.deepEqual(first[0], { repo: "owner/repo", approved: true, asks: ["audit (path:src/)"] });
    assert.deepEqual(first.slice(1).map((r) => r.approved), [false, false, false, false, false]);
    assert.match(first[1]!.reason ?? "", /no AGENTS-CONTRIBUTING\.md/);
    assert.equal(first[2]!.reason, "private");
    assert.equal(first[3]!.reason, "is a runner repository");
    assert.deepEqual(loadConfig(fresh).targets.repos, [HOME_REPO, "owner/repo"]);

    // An existing config keeps its other settings and its comments.
    const existing = join(dir, "contributor.yml");
    writeFileSync(existing, "# mine\nprovider: codex\ntargets:\n  repos: [a/b]\n  topics: []\nbudget:\n  margin_pct: 25 # keep more\n");
    await approve(gh, ["owner/repo", "a/b"], existing);
    const after = loadConfig(existing);
    assert.deepEqual(after.targets, { repos: ["a/b", "owner/repo"], topics: [], auto_approve: false });
    assert.equal(after.provider, "codex");
    assert.equal(after.budget.margin_pct, 25);
    assert.match(readFileSync(existing, "utf8"), /# mine[\s\S]*# keep more/);

    // Nothing passes: nothing is written.
    const untouched = join(dir, "none.yml");
    await approve(gh, ["nofile/repo"], untouched);
    assert.throws(() => readFileSync(untouched));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("approved repositories: the default, the environment, and a bad name", async () => {
  const { loadConfig, approvedInEnv, HOME_REPO, DEFAULT_CONFIG_PATH } = await import("../src/balance/config.ts");
  const { existsSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  assert.deepEqual(approvedInEnv({ AGENTS_CONTRIBUTING_REPOS: "a/b, c/d  e/f" }), ["a/b", "c/d", "e/f"]);
  assert.deepEqual(approvedInEnv({}), []);
  if (!existsSync(DEFAULT_CONFIG_PATH)) {
    const defaults = loadConfig().targets;
    assert.deepEqual(defaults.repos, [HOME_REPO], "with no config, only the project's own repository is approved");
    assert.equal(defaults.auto_approve, false);
  }
  const dir = mkdtempSync(join(tmpdir(), "ac-targets-"));
  const saved = process.env.AGENTS_CONTRIBUTING_REPOS;
  try {
    const path = join(dir, "c.yml");
    writeFileSync(path, "targets:\n  repos: [a/b]\n");
    process.env.AGENTS_CONTRIBUTING_REPOS = "c/d,a/b";
    assert.deepEqual(loadConfig(path).targets.repos, ["a/b", "c/d"]);
    process.env.AGENTS_CONTRIBUTING_REPOS = "https://github.com/c/d";
    assert.throws(() => loadConfig(path), /not a repository name/);
    delete process.env.AGENTS_CONTRIBUTING_REPOS;
    writeFileSync(path, "targets:\n  auto_approve: yes please\n");
    assert.throws(() => loadConfig(path), /auto_approve must be true or false/);
  } finally {
    if (saved === undefined) delete process.env.AGENTS_CONTRIBUTING_REPOS; else process.env.AGENTS_CONTRIBUTING_REPOS = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
