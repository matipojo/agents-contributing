#!/usr/bin/env -S npx tsx
/**
 * The contribution runner: makes at most one contribution, then exits. A routine runs it again
 * after each contribution until the balance check says to stop.
 *
 * Usage: npx tsx src/cli/run.ts [--dry-run] [--force] [path/to/contributor.yml]
 *   --dry-run  do everything except writing to GitHub; print what would be submitted
 *   --force    contribute even when the balance check says not to (recorded in the output and log)
 *
 * Writing needs AGENTS_CONTRIBUTING_GITHUB_TOKEN: a token that may open issues, pull requests
 * and reviews on public repositories and write to the runner repository. Without it the run is
 * a dry run. Exit codes: 0 contributed (or would have), 10 nothing to do, 2 error.
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG_PATH, HOME, loadConfig, type ContributorConfig } from "../balance/config.ts";
import { ADAPTERS } from "../balance/adapters/index.ts";
import { decide } from "../balance/decide.ts";
import type { Agent } from "../balance/types.ts";
import {
  contributionMarker, effectiveForbiddenPaths, effectiveLimits, HELP_PREFIX, validateText, type AgentsContributing,
} from "../spec.ts";
import { GitHub, type Issue, type Repo } from "../runner/github.ts";
import { allowance, checkChange, markerType, parseNumstat, type Contribution } from "../runner/policy.ts";
import {
  auditPrompt, fixPrompt, parseFindings, parseFix, parseReview, reviewPrompt, SUPPORTED_TYPES, type SupportedType,
} from "../runner/tasks.ts";

const RUNNER_TOPIC = "agents-contributing-runner";
const VERSION = `agents-contributing/${JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version}`;

const args = process.argv.slice(2);
const flag = (f: string) => {
  const i = args.indexOf(f);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const force = flag("--force");
const token = process.env.AGENTS_CONTRIBUTING_GITHUB_TOKEN?.trim() || null;
const dryRun = flag("--dry-run") || !token;
const configPath = args[0] ?? DEFAULT_CONFIG_PATH;
const notes: string[] = [];

const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

function finish(code: number, result: Record<string, unknown>): never {
  console.log(JSON.stringify({ dry_run: dryRun, forced: force, ...result, notes }, null, 2));
  process.exit(code);
}

interface Target {
  repo: Repo;
  file: AgentsContributing;
  notes: string;
  past: Contribution[];
  items: Issue[];
}

/** Reads and validates a target's AGENTS-CONTRIBUTING.md from its default branch. */
async function readTarget(gh: GitHub, name: string): Promise<{ file: AgentsContributing; notes: string } | string> {
  const repo = await gh.repo(name);
  const text = await gh.file(name, "AGENTS-CONTRIBUTING.md", repo.default_branch);
  if (text === null) return "no AGENTS-CONTRIBUTING.md on the default branch";
  const v = validateText(text);
  if (!v.data) return `AGENTS-CONTRIBUTING.md is invalid: ${v.errors.join(" ")}`;
  return { file: v.data, notes: text.replace(/^---[\s\S]*?\n---[ \t]*\r?\n?/, "").trim() };
}

function allowedProvider(file: AgentsContributing, vendor: string, provider: string): boolean {
  const p = file.providers;
  const names = [vendor, provider];
  if (p?.deny?.some((d) => names.includes(d))) return false;
  return !p?.allow || p.allow.some((a) => names.includes(a));
}

/**
 * A fresh checkout of the default branch. Dependencies are installed here, without install
 * scripts, because the agent's sandbox has no network and needs them to run the checks.
 */
function clone(name: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), "ac-target-")), "repo");
  execFileSync("git", ["clone", "--quiet", "--depth", "50", `https://github.com/${name}.git`, dir], { stdio: "ignore" });
  if (existsSync(join(dir, "package-lock.json"))) {
    try {
      execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--silent"], { cwd: dir, stdio: "ignore", timeout: 600_000 });
    } catch {
      notes.push(`npm ci failed in ${name}; the agent works without dependencies.`);
    }
  }
  return dir;
}

/** Re-reads the file right before submitting: the owner may have changed or removed it. */
async function stillAllowed(gh: GitHub, name: string, type: string, scope: string | undefined): Promise<string | null> {
  const now = await readTarget(gh, name);
  if (typeof now === "string") return now;
  const h = now.file[`${HELP_PREFIX}${type}`];
  if (!h?.enabled) return `help_${type} is no longer enabled`;
  if (h.scope !== scope) return `help_${type} changed its scope to ${h.scope}`;
  return null;
}

async function log(gh: GitHub, cfg: ContributorConfig, runnerRepo: string, entry: Record<string, unknown>): Promise<void> {
  if (!cfg.log) return;
  const line = JSON.stringify(entry);
  if (dryRun) {
    appendFileSync(join(HOME, "dry-run-contributions.jsonl"), line + "\n");
    return;
  }
  await gh.appendLine(runnerRepo, "contributions.jsonl", line, `Log ${entry.type} contribution to ${entry.repo}`);
}

async function main(): Promise<void> {
  const cfg = loadConfig(configPath);
  const adapter = ADAPTERS[cfg.provider];
  if (!adapter) throw new Error(`Unknown provider "${cfg.provider}".`);
  const agent: Agent | undefined = adapter.agent;
  if (!agent) throw new Error(`The "${cfg.provider}" provider cannot run an agent for the runner.`);
  const gh = new GitHub(token);
  if (!token) notes.push("No AGENTS_CONTRIBUTING_GITHUB_TOKEN, so this is a dry run: nothing is written to GitHub.");

  // 1. Only donate what the balance check allows.
  const now = new Date();
  const balance = decide(cfg, adapter.read(cfg, now), now, adapter.spentUsd?.() ?? null);
  const go = balance.verdict === "contribute" || balance.verdict === "contribute-until-limited";
  if (!go && !force) finish(balance.verdict === "unknown" ? 2 : 10, { result: "skipped", balance });
  if (!go) notes.push(`The balance check says ${balance.verdict} (${balance.reason}). Contributing anyway because of --force.`);

  // 2. Who we are, and where the log goes. Contributing without the runner repository is not allowed.
  const login = token ? await gh.login() : process.env.AGENTS_CONTRIBUTING_GITHUB_LOGIN ?? null;
  if (!login) throw new Error("Unknown GitHub login. Set AGENTS_CONTRIBUTING_GITHUB_TOKEN (or AGENTS_CONTRIBUTING_GITHUB_LOGIN for a dry run).");
  const runnerRepo = cfg.runner_repo ?? `${login}/agents-contributing-runner`;
  let runner: Repo | null = null;
  let problem = "";
  try {
    runner = (await gh.exists(runnerRepo)) ? await gh.repo(runnerRepo) : null;
    if (!runner) problem = `${runnerRepo} does not exist`;
    else if (!runner.topics?.includes(RUNNER_TOPIC)) problem = `${runnerRepo} lacks the ${RUNNER_TOPIC} topic`;
  } catch (e) {
    if (!dryRun) throw e;
    problem = `${runnerRepo} could not be read (${(e as Error).message.slice(0, 80)})`;
  }
  if (problem) {
    if (!dryRun) {
      finish(2, { result: "unknown", reason: `${problem}. Create it once with the commands in skills/join-as-contributor/SKILL.md, step 4.` });
    }
    notes.push(`${problem}; a real run would stop here.`);
  }

  // 3. Targets: the repositories the contributor chose, plus topic search where it works.
  const names = new Set(cfg.targets.repos);
  for (const topic of cfg.targets.topics) {
    try {
      const found = await gh.request<{ items: { full_name: string }[] }>("GET", `/search/repositories?q=topic:${encodeURIComponent(topic)}&per_page=50`);
      for (const r of found.items) names.add(r.full_name);
    } catch (e) {
      notes.push(`Topic search for "${topic}" failed (${(e as Error).message.slice(0, 80)}); using targets.repos only.`);
    }
  }
  if (names.size === 0) finish(10, { result: "nothing-to-do", reason: "No target repositories." });

  const skipped: Record<string, string> = {};
  for (const name of names) {
    if (name === runnerRepo) continue;
    const repo = await gh.repo(name);
    if (repo.private) { skipped[name] = "private"; continue; }
    if (repo.topics?.includes(RUNNER_TOPIC)) { skipped[name] = "is a runner repository"; continue; }
    const read = await readTarget(gh, name);
    if (typeof read === "string") { skipped[name] = read; continue; }
    if (!allowedProvider(read.file, agent.vendor, cfg.provider)) { skipped[name] = "the providers list excludes this agent"; continue; }

    const since = new Date(now.getTime() - 30 * 24 * 3_600_000).toISOString();
    const items = await gh.issues(name, `state=all&since=${since}`);
    const past: Contribution[] = items.flatMap((i) => {
      const type = markerType(i.body);
      return type ? [{ type, author: i.user?.login ?? "", open: i.state === "open", at: new Date(i.created_at) }] : [];
    });
    const target: Target = { repo, file: read.file, notes: read.notes, past, items };

    const types = cfg.help_types.filter((t): t is SupportedType =>
      (SUPPORTED_TYPES as readonly string[]).includes(t) && read.file[`${HELP_PREFIX}${t}`]?.enabled === true);
    if (types.length === 0) { skipped[name] = "no enabled help type in help_types that the runner supports"; continue; }

    for (const type of types) {
      const help = read.file[`${HELP_PREFIX}${type}`]!;
      const left = allowance(effectiveLimits(read.file, type), help.limits ?? {}, type, login, past, now);
      if (left.left <= 0) { skipped[`${name} ${type}`] = left.reason; continue; }
      const done = await contribute(gh, cfg, agent, target, type, left.left, login, runnerRepo);
      if (done) finish(0, { result: dryRun ? "would-contribute" : "contributed", balance: balance.verdict, ...done });
      skipped[`${name} ${type}`] = "no task in scope";
    }
  }
  finish(10, { result: "nothing-to-do", skipped });
}

/** Makes one contribution of `type`, or returns null when there is no task for it. */
async function contribute(
  gh: GitHub, cfg: ContributorConfig, agent: Agent, t: Target, type: SupportedType,
  left: number, login: string, runnerRepo: string,
): Promise<Record<string, unknown> | null> {
  const name = t.repo.full_name;
  const help = t.file[`${HELP_PREFIX}${type}`]!;
  const scope = help.scope ?? "";
  const [kind, value] = [scope.slice(0, scope.indexOf(":")), scope.slice(scope.indexOf(":") + 1)];
  const marker = (model: string) =>
    contributionMarker({ type, provider: agent.vendor, model, runner: VERSION, from: runnerRepo });
  const logEntry = (url: string, model: string) => ({
    v: 1, type, repo: name, url, provider: agent.vendor, model, runner: VERSION, at: new Date().toISOString(),
    ...(force ? { forced: true } : {}),
  });
  const openIssues = t.items.filter((i) => i.state === "open" && !i.pull_request);
  const openPulls = t.items.filter((i) => i.state === "open" && i.pull_request);

  if (type === "audit") {
    if (kind !== "path") { notes.push(`help_audit scope ${scope} is not a path; skipped.`); return null; }
    const dir = clone(name);
    const max = Math.min(left, 5);
    const res = agent.run({ cwd: dir, write: false, prompt: auditPrompt({ dir: value, max, openTitles: openIssues.map((i) => i.title), notes: t.notes }) });
    const known = new Set(openIssues.map((i) => i.title.trim().toLowerCase()));
    const findings = parseFindings(res.text, max).filter((f) => !known.has(f.title.toLowerCase()));
    if (findings.length === 0) return { repo: name, type, model: res.model, submitted: [], reason: "the audit found nothing new" };
    const why = await stillAllowed(gh, name, type, help.scope);
    if (why) return { repo: name, type, aborted: why };
    const submitted: string[] = [];
    for (const f of findings) {
      const body = `${f.body}\n\n---\nFound by an AI agent auditing \`${value}\` under AGENTS-CONTRIBUTING.md.\n\n${marker(res.model)}`;
      if (dryRun) { submitted.push(`(dry run) issue: ${f.title}`); notes.push(`Would open issue "${f.title}":\n${body}`); }
      else submitted.push((await gh.createIssue(name, f.title, body)).html_url);
      await log(gh, cfg, runnerRepo, logEntry(submitted.at(-1)!, res.model));
    }
    return { repo: name, type, model: res.model, submitted };
  }

  if (type === "pr") {
    if (kind !== "label") { notes.push(`help_pr scope ${scope} is not a label; skipped.`); return null; }
    // Skip an issue an agent pull request already claims (spec obligation 5).
    const claimed = new Set(openPulls.filter((p) => markerType(p.body)).flatMap((p) => [...(p.body ?? "").matchAll(/#(\d+)/g)].map((m) => Number(m[1]))));
    const issue = openIssues.find((i) => i.labels.some((l) => l.name === value) && !claimed.has(i.number));
    if (!issue) return null;
    const dir = clone(name);
    const branch = `agents-contributing/issue-${issue.number}`;
    git(dir, "checkout", "-q", "-b", branch);
    const forbidden = effectiveForbiddenPaths(t.file, type);
    const res = agent.run({
      cwd: dir, write: true,
      prompt: fixPrompt({ issue: { number: issue.number, title: issue.title, body: issue.body ?? "" }, forbidden, maxDiffLines: help.max_diff_lines, require: help.require ?? [], notes: t.notes }),
    });
    const fix = parseFix(res.text);
    if ("skip" in fix) return { repo: name, type, issue: issue.number, model: res.model, skipped: fix.skip };
    git(dir, "add", "-A");
    const changes = parseNumstat(git(dir, "diff", "--cached", "--numstat"));
    const errors = checkChange(changes, { forbidden, maxDiffLines: help.max_diff_lines, require: help.require });
    if (errors.length) return { repo: name, type, issue: issue.number, model: res.model, rejected: errors };
    const why = await stillAllowed(gh, name, type, help.scope);
    if (why) return { repo: name, type, aborted: why };
    const body = [
      fix.summary, `Closes #${issue.number}`,
      "---\nThis pull request was written by an AI agent under this repository's AGENTS-CONTRIBUTING.md. " +
        "The runner checked its scope, forbidden paths, size and required tests before opening it.",
      marker(res.model),
    ].join("\n\n");
    const stat = changes.map((c) => `${c.path} +${c.added} -${c.deleted}`);
    if (dryRun) {
      notes.push(`Would open a draft pull request "${fix.title}" from ${branch}:\n${body}\n\n${git(dir, "diff", "--cached")}`);
      await log(gh, cfg, runnerRepo, logEntry("(dry run)", res.model));
      return { repo: name, type, issue: issue.number, model: res.model, changes: stat, submitted: ["(dry run) draft pull request"] };
    }
    git(dir, "-c", `user.name=${login}`, "-c", `user.email=${login}@users.noreply.github.com`,
      "commit", "-q", "-m", `${fix.title}\n\nCloses #${issue.number}\n\nAgents-Contributing: ${marker(res.model).replace(/^agents-contributing: /, "")}`);
    // Without push access to the target, push to a fork.
    let head = branch;
    let pushTo = name;
    if (!t.repo.permissions?.push) {
      pushTo = (await gh.fork(name)).full_name;
      head = `${pushTo.split("/")[0]}:${branch}`;
    }
    execFileSync("git", ["push", "-q", `https://github.com/${pushTo}.git`, `HEAD:refs/heads/${branch}`],
      { cwd: dir, env: gh.gitAuthEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const pr = await gh.createPull(name, { title: fix.title, body, head, base: t.repo.default_branch });
    await log(gh, cfg, runnerRepo, logEntry(pr.html_url, res.model));
    return { repo: name, type, issue: issue.number, model: res.model, changes: stat, submitted: [pr.html_url] };
  }

  // review
  if (kind !== "label") { notes.push(`help_review scope ${scope} is not a label; skipped.`); return null; }
  for (const p of openPulls.filter((p) => p.labels.some((l) => l.name === value) && p.user?.login !== login)) {
    const reviews = await gh.reviews(name, p.number);
    if (reviews.some((r) => r.user?.login === login && markerType(r.body))) continue;
    const diff = await gh.pullDiff(name, p.number);
    const dir = clone(name);
    const res = agent.run({ cwd: dir, write: false, prompt: reviewPrompt({ number: p.number, title: p.title, body: p.body ?? "", diff, notes: t.notes }) });
    const why = await stillAllowed(gh, name, type, help.scope);
    if (why) return { repo: name, type, aborted: why };
    const body = `${parseReview(res.text)}\n\n---\nReview by an AI agent under this repository's AGENTS-CONTRIBUTING.md.\n\n${marker(res.model)}`;
    if (dryRun) {
      notes.push(`Would review #${p.number}:\n${body}`);
      await log(gh, cfg, runnerRepo, logEntry("(dry run)", res.model));
      return { repo: name, type, pull: p.number, model: res.model, submitted: ["(dry run) review"] };
    }
    const r = await gh.review(name, p.number, body);
    await log(gh, cfg, runnerRepo, logEntry(r.html_url, res.model));
    return { repo: name, type, pull: p.number, model: res.model, submitted: [r.html_url] };
  }
  return null;
}

main().catch((e) => finish(2, { result: "error", reason: (e as Error).message }));
