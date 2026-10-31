import { test } from "node:test";
import assert from "node:assert/strict";
import { allowance, checkChange, extractJson, markerType, parseNumstat, type Contribution } from "../src/runner/policy.ts";
import { parseFindings, parseFix, parseReview } from "../src/runner/tasks.ts";

const now = new Date("2026-10-29T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
const limits = { max_open_agent_contributions: 3, max_per_contributor_per_week: 1, cooldown_hours: 24 };
const c = (type: string, author: string, open: boolean, hoursAgo: number): Contribution => ({ type, author, open, at: ago(hoursAgo) });

test("markerType reads the help type from a contribution marker", () => {
  assert.equal(markerType("text\n\nagents-contributing: v1 type=audit provider=openai model=m runner=r from=a/b"), "audit");
  assert.equal(markerType("no marker here"), null);
  assert.equal(markerType(null), null);
});

test("allowance: nothing before, so one contribution under a cooldown", () => {
  assert.deepEqual(allowance(limits, {}, "pr", "me", [], now), { left: 1, reason: "" });
});

test("allowance: the weekly limit counts only my contributions", () => {
  assert.equal(allowance(limits, {}, "pr", "me", [c("pr", "someone", false, 2)], now).left, 1);
  assert.match(allowance(limits, {}, "pr", "me", [c("pr", "me", false, 100)], now).reason, /this week/);
});

test("allowance: open contributions from anyone count toward the repository cap", () => {
  const past = [c("pr", "a", true, 1), c("pr", "b", true, 1), c("audit", "c", true, 1)];
  assert.match(allowance(limits, {}, "pr", "me", past, now).reason, /are open/);
});

test("allowance: a limit the help type sets itself counts only that type", () => {
  const own = { max_open_agent_contributions: 5, max_per_contributor_per_week: 5, cooldown_hours: 0 };
  const past = [c("pr", "me", true, 1), c("audit", "me", true, 1), c("audit", "me", true, 1)];
  assert.deepEqual(allowance(own, own, "audit", "me", past, now), { left: 3, reason: "" });
});

test("allowance: the cooldown blocks until it passes", () => {
  const lim = { ...limits, max_per_contributor_per_week: 5 };
  assert.match(allowance(lim, {}, "pr", "me", [c("pr", "me", false, 3)], now).reason, /cooldown/);
  assert.equal(allowance(lim, {}, "pr", "me", [c("pr", "me", false, 30)], now).left, 1);
});

test("checkChange enforces forbidden paths, size and required tests", () => {
  const changes = parseNumstat("10\t2\tsrc/a.ts\x003\t0\t.github/workflows/ci.yml\x00");
  const errors = checkChange(changes, { forbidden: [".github/"], maxDiffLines: 10, require: ["tests"] });
  assert.equal(errors.length, 3);
  assert.match(errors.join(" "), /forbidden_paths/);
  assert.match(errors.join(" "), /max_diff_lines/);
  assert.match(errors.join(" "), /requires tests/);
});

test("checkChange accepts a small change with a test", () => {
  const changes = parseNumstat("8\t1\tsrc/spec.ts\x0012\t0\ttest/spec.test.ts\x00");
  assert.deepEqual(checkChange(changes, { forbidden: [".github/", "package.json"], maxDiffLines: 300, require: ["tests", "disclosure"] }), []);
});

test("checkChange: a forbidden file matches exactly, not by prefix of a longer name", () => {
  assert.deepEqual(checkChange(parseNumstat("1\t0\tpackage.json.bak\x00"), { forbidden: ["package.json"] }), []);
  assert.equal(checkChange(parseNumstat("1\t0\tpackage.json\x00"), { forbidden: ["package.json"] }).length, 1);
});

test("checkChange: no change is not a contribution", () => {
  assert.match(checkChange([], { forbidden: [] }).join(" "), /no files/);
});

test("extractJson finds JSON inside prose or a code fence", () => {
  assert.deepEqual(extractJson('Here:\n```json\n[{"a":1}]\n```\nDone.'), [{ a: 1 }]);
  assert.deepEqual(extractJson('Result {"title":"x","summary":"y"} end'), { title: "x", summary: "y" });
  assert.throws(() => extractJson("nothing"), /no JSON/);
});

test("parseFindings keeps valid findings up to the cap", () => {
  const text = JSON.stringify([{ title: "A", body: "a" }, { title: "", body: "x" }, { nope: 1 }, { title: "B", body: "b" }, { title: "C", body: "c" }]);
  assert.deepEqual(parseFindings(text, 2).map((f) => f.title), ["A", "B"]);
});

test("parseFix and parseReview read the agent's reply", () => {
  assert.deepEqual(parseFix('{"skip":"too big"}'), { skip: "too big" });
  assert.deepEqual(parseFix('{"title":"Fix x","summary":"Did y"}'), { title: "Fix x", summary: "Did y" });
  assert.equal(parseReview('{"body":"Looks fine"}'), "Looks fine");
  assert.throws(() => parseReview('{"body":""}'));
});

test("git push gets the token from the environment, never from its arguments", async () => {
  const { GitHub } = await import("../src/runner/github.ts");
  const env = new GitHub("secret-token").gitAuthEnv();
  assert.equal(env.GIT_CONFIG_KEY_0, "http.https://github.com/.extraheader");
  assert.equal(Buffer.from(env.GIT_CONFIG_VALUE_0!.split(" ").pop()!, "base64").toString(), "x-access-token:secret-token");
  assert.throws(() => new GitHub(null).gitAuthEnv(), /needs a GitHub login/);
});

test("parseNumstat with -z: special characters and renames cannot hide a forbidden path", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "ac-git-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base");
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "é x.yml"), "on: push\n");
  git("add", "-A");
  const changes = parseNumstat(git("diff", "--cached", "--numstat", "-z", "HEAD"));
  assert.deepEqual(changes.map((c) => c.path), [".github/workflows/é x.yml"]);
  assert.match(checkChange(changes, { forbidden: [".github/"] }).join(" "), /forbidden_paths/);
  // A rename out of a forbidden directory still touches it.
  const renamed = parseNumstat("0\t0\t\x00.github/a.yml\x00src/a.yml\x00");
  assert.deepEqual(renamed.map((c) => c.path), [".github/a.yml", "src/a.yml"]);
});

test("the provider is detected from the agent the runner is called from", async () => {
  const { detectProvider } = await import("../src/balance/config.ts");
  assert.equal(detectProvider({ CODEX_THREAD_ID: "t" }), "codex");
  assert.equal(detectProvider({ CLAUDECODE: "1" }), "claude-code");
  // An agent no adapter recognizes still works, through the fallback.
  assert.equal(detectProvider({}), "declared");
});

test("findToken prefers AGENTS_CONTRIBUTING_GITHUB_TOKEN over the gh login", async () => {
  const { findToken } = await import("../src/runner/github.ts");
  const before = process.env.AGENTS_CONTRIBUTING_GITHUB_TOKEN;
  process.env.AGENTS_CONTRIBUTING_GITHUB_TOKEN = "own-token";
  try {
    assert.deepEqual(findToken(), { token: "own-token", source: "AGENTS_CONTRIBUTING_GITHUB_TOKEN" });
  } finally {
    if (before === undefined) delete process.env.AGENTS_CONTRIBUTING_GITHUB_TOKEN;
    else process.env.AGENTS_CONTRIBUTING_GITHUB_TOKEN = before;
  }
});

test("a scope label with a colon in its name, such as agents:fix-wanted, picks the right issue", async () => {
  const { pick } = await import("../src/runner/flow.ts");
  const { GitHub } = await import("../src/runner/github.ts");
  const { loadConfig } = await import("../src/balance/config.ts");
  const gh = new GitHub(null);
  gh.repo = async () => ({ full_name: "owner/repo", default_branch: "main", private: false });
  gh.file = async () => "---\nversion: 1\nhelp_pr:\n  enabled: true\n  scope: label:agents:fix-wanted\n  output: pr\n" +
    "limits:\n  max_open_agent_contributions: 3\n  max_per_contributor_per_week: 1\n  cooldown_hours: 0\n---\n";
  const issue = (number: number, label: string) => ({
    number, title: `#${number}`, body: "", state: "open", user: { login: "someone" }, labels: [{ name: label }], created_at: new Date().toISOString(), html_url: "",
  });
  gh.issues = async () => [issue(1, "agents"), issue(2, "fix-wanted"), issue(3, "agents:fix-wanted")];
  const cfg = { ...loadConfig("templates/contributor.yml"), targets: { repos: ["owner/repo"], topics: [] }, help_types: ["pr"] };
  const ctx = { cfg, gh, login: "me", runnerRepo: null, vendor: "test", dryRun: true, forced: false, notes: [] };
  assert.equal((await pick(ctx)).task?.issue?.number, 3);
});

const rejected = (reason: string, type: string, daysAgo: number, login = "me") => ({
  body: `x\n\nagents-contributing: v1 type=${type} provider=openai model=m runner=r from=me`,
  user: { login }, labels: [{ name: `agents:rejected-${reason}` }],
  created_at: new Date(Date.now() - 40 * 864e5).toISOString(),
  updated_at: new Date(Date.now() - daysAgo * 864e5).toISOString(), html_url: `https://x/${reason}`,
});

test("rejections: each reason pauses for its own time and scope", async () => {
  const { rejectionsOf, rejectionPause, slowedDown } = await import("../src/runner/policy.ts");
  const now = new Date();
  const spam = rejectionsOf([rejected("spam", "audit", 10)], "me");
  assert.match(rejectionPause(spam, "pr", now) ?? "", /spam.*in this repository/);
  assert.equal(slowedDown(spam, now), true);
  assert.equal(rejectionPause(rejectionsOf([rejected("spam", "audit", 31)], "me"), "pr", now), null);

  const wrong = rejectionsOf([rejected("wrong", "pr", 3)], "me");
  assert.match(rejectionPause(wrong, "pr", now) ?? "", /wrong.*for pr/);
  assert.equal(rejectionPause(wrong, "audit", now), null, "wrong pauses only the rejected help type");
  assert.equal(rejectionPause(rejectionsOf([rejected("out-of-scope", "pr", 8)], "me"), "pr", now), null, "after 7 days");
  assert.equal(rejectionPause(rejectionsOf([rejected("duplicate", "pr", 0)], "me"), "pr", now), null, "duplicate never pauses");
  assert.equal(slowedDown(wrong, now), false);
});

test("rejections: only this contributor's marked contributions count, and unknown reasons are ignored", async () => {
  const { rejectionsOf } = await import("../src/runner/policy.ts");
  assert.equal(rejectionsOf([rejected("spam", "audit", 1, "someone-else")], "me").length, 0);
  assert.equal(rejectionsOf([{ ...rejected("spam", "audit", 1), body: "no marker" }], "me").length, 0);
  assert.equal(rejectionsOf([rejected("rude", "audit", 1)], "me").length, 0);
});

test("pick skips a repository with a recent spam rejection, and a type rejected as wrong", async () => {
  const { pick } = await import("../src/runner/flow.ts");
  const { GitHub } = await import("../src/runner/github.ts");
  const { loadConfig } = await import("../src/balance/config.ts");
  const gh = new GitHub(null);
  gh.repo = async () => ({ full_name: "owner/repo", default_branch: "main", private: false });
  gh.file = async () => "---\nversion: 1\nhelp_audit:\n  enabled: true\n  scope: path:src/\n  output: issue\n" +
    "limits:\n  max_open_agent_contributions: 9\n  max_per_contributor_per_week: 9\n  cooldown_hours: 0\n---\n";
  const cfg = { ...loadConfig("templates/contributor.yml"), targets: { repos: ["owner/repo"], topics: [] }, help_types: ["audit"] };
  const ctx = { cfg, gh, login: "me", runnerRepo: null, vendor: "test", dryRun: true, forced: false, notes: [] as string[] };
  gh.issues = async () => [{ ...rejected("spam", "audit", 2), number: 1, title: "t", state: "closed" }];
  const spam = await pick(ctx);
  assert.equal(spam.task, undefined);
  assert.match(Object.values(spam.skipped).join(" "), /spam/);
  gh.issues = async () => [{ ...rejected("wrong", "audit", 2), number: 1, title: "t", state: "closed" }];
  assert.match(Object.values((await pick(ctx)).skipped).join(" "), /wrong.*for audit/);
  gh.issues = async () => [{ ...rejected("duplicate", "audit", 0), number: 1, title: "t", state: "closed" }];
  const dup = await pick(ctx);
  assert.equal(dup.task?.type, "audit", "a duplicate does not pause");
  assert.match(ctx.notes.join(" "), /rejected as duplicates/);
});
