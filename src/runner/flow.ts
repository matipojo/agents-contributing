/**
 * The runner's three stages, shared by both ways of running it:
 *   pick    - choose one task that the balance, the repository's file and the limits allow
 *   prepare - check out the repository at a known commit, and save the task to disk
 *   submit  - check what the agent produced, re-read the file, submit, and log
 * Between prepare and submit, an agent does the work: one the runner launches itself
 * (`run.ts`), or the agent that is already running and called `run.ts next` (a routine).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { HOME, type ContributorConfig } from "../balance/config.ts";
import { ADAPTERS } from "../balance/adapters/index.ts";
import { decide, type Decision } from "../balance/decide.ts";
import {
  contributionMarker, effectiveForbiddenPaths, effectiveLimits, HELP_PREFIX, validateText, type AgentsContributing,
} from "../spec.ts";
import { GitHub, type Issue, type Repo } from "./github.ts";
import { allowance, checkChange, markerType, parseNumstat, type Contribution } from "./policy.ts";
import {
  auditPrompt, fixPrompt, parseFindings, parseFix, parseReview, reviewPrompt, SUPPORTED_TYPES, type SupportedType,
} from "./tasks.ts";

const RUNNER_TOPIC = "agents-contributing-runner";
export const VERSION = `agents-contributing/${JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version}`;
export const WORK = join(HOME, "work");

/** The marker's provider field for each adapter; `declared` names no vendor. */
const VENDORS: Record<string, string> = { "claude-code": "anthropic", codex: "openai" };

export interface Context {
  cfg: ContributorConfig;
  gh: GitHub;
  login: string;
  runnerRepo: string;
  vendor: string;
  dryRun: boolean;
  forced: boolean;
  notes: string[];
}

/** Everything submit needs, saved by prepare. */
export interface TaskState {
  id: string;
  type: SupportedType;
  repo: string;
  dir: string;
  baseSha: string;
  defaultBranch: string;
  pushAccess: boolean;
  scope: string;
  forbidden: string[];
  maxDiffLines?: number;
  require: string[];
  max?: number;
  openTitles?: string[];
  issue?: { number: number; title: string };
  pull?: { number: number };
  branch?: string;
  prompt: string;
  replyFile: string;
  runnerRepo: string;
  login: string;
  vendor: string;
  forced: boolean;
  dryRun: boolean;
}

const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

/** Checks the balance and the runner repository. Returns why not to contribute, or null. */
export async function setup(
  cfg: ContributorConfig, token: string | null, flags: { dryRun: boolean; force: boolean },
): Promise<{ ctx?: Context; stop?: { code: number; result: Record<string, unknown> } }> {
  const adapter = ADAPTERS[cfg.provider];
  if (!adapter) throw new Error(`Unknown provider "${cfg.provider}".`);
  const dryRun = flags.dryRun || !token;
  const notes: string[] = [];
  const gh = new GitHub(token);
  if (!token) notes.push("No AGENTS_CONTRIBUTING_GITHUB_TOKEN, so this is a dry run: nothing is written to GitHub.");

  // Only donate what the balance check allows.
  const now = new Date();
  const balance: Decision = decide(cfg, adapter.read(cfg, now), now, adapter.spentUsd?.() ?? null);
  const go = balance.verdict === "contribute" || balance.verdict === "contribute-until-limited";
  if (!go && !flags.force) {
    return { stop: { code: balance.verdict === "unknown" ? 2 : 10, result: { result: "skipped", balance, notes } } };
  }
  if (!go) notes.push(`The balance check says ${balance.verdict} (${balance.reason}). Contributing anyway because of --force.`);

  // Contributing without the runner repository is not allowed: every contribution is logged there.
  const login = token ? await gh.login() : process.env.AGENTS_CONTRIBUTING_GITHUB_LOGIN ?? null;
  if (!login) throw new Error("Unknown GitHub login. Set AGENTS_CONTRIBUTING_GITHUB_TOKEN (or AGENTS_CONTRIBUTING_GITHUB_LOGIN for a dry run).");
  const runnerRepo = cfg.runner_repo ?? `${login}/agents-contributing-runner`;
  let problem = "";
  try {
    const runner = (await gh.exists(runnerRepo)) ? await gh.repo(runnerRepo) : null;
    if (!runner) problem = `${runnerRepo} does not exist`;
    else if (!runner.topics?.includes(RUNNER_TOPIC)) problem = `${runnerRepo} lacks the ${RUNNER_TOPIC} topic`;
  } catch (e) {
    if (!dryRun) throw e;
    problem = `${runnerRepo} could not be read (${(e as Error).message.slice(0, 80)})`;
  }
  if (problem && !dryRun) {
    return { stop: { code: 2, result: { result: "unknown", reason: `${problem}. Create it once with skills/join-as-contributor/setup-runner.sh.`, notes } } };
  }
  if (problem) notes.push(`${problem}; a real run would stop here.`);
  return { ctx: { cfg, gh, login, runnerRepo, vendor: VENDORS[cfg.provider] ?? cfg.provider, dryRun, forced: flags.force, notes } };
}

interface Target {
  repo: Repo;
  file: AgentsContributing;
  notes: string;
  items: Issue[];
  past: Contribution[];
}

async function readFile(gh: GitHub, name: string): Promise<{ file: AgentsContributing; notes: string } | string> {
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

/** One task, before it is checked out. */
export interface Pick {
  target: Target;
  type: SupportedType;
  left: number;
  issue?: Issue;
  pull?: Issue;
}

/** Chooses the first task that every rule allows, or reports why there is none. */
export async function pick(ctx: Context): Promise<{ task?: Pick; skipped: Record<string, string> }> {
  const { cfg, gh, login, runnerRepo, notes } = ctx;
  const names = new Set(cfg.targets.repos);
  for (const topic of cfg.targets.topics) {
    try {
      const found = await gh.request<{ items: { full_name: string }[] }>("GET", `/search/repositories?q=topic:${encodeURIComponent(topic)}&per_page=50`);
      for (const r of found.items) names.add(r.full_name);
    } catch (e) {
      notes.push(`Topic search for "${topic}" failed (${(e as Error).message.slice(0, 80)}); using targets.repos only.`);
    }
  }
  const skipped: Record<string, string> = {};
  const now = new Date();
  for (const name of names) {
    if (name === runnerRepo) continue;
    const repo = await gh.repo(name);
    if (repo.private) { skipped[name] = "private"; continue; }
    if (repo.topics?.includes(RUNNER_TOPIC)) { skipped[name] = "is a runner repository"; continue; }
    const read = await readFile(gh, name);
    if (typeof read === "string") { skipped[name] = read; continue; }
    if (!allowedProvider(read.file, ctx.vendor, cfg.provider)) { skipped[name] = "the providers list excludes this agent"; continue; }

    const since = new Date(now.getTime() - 30 * 24 * 3_600_000).toISOString();
    const items = await gh.issues(name, `state=all&since=${since}`);
    const past: Contribution[] = items.flatMap((i) => {
      const type = markerType(i.body);
      return type ? [{ type, author: i.user?.login ?? "", open: i.state === "open", at: new Date(i.created_at) }] : [];
    });
    const target: Target = { repo, file: read.file, notes: read.notes, items, past };
    const openIssues = items.filter((i) => i.state === "open" && !i.pull_request);
    const openPulls = items.filter((i) => i.state === "open" && i.pull_request);

    const types = cfg.help_types.filter((t): t is SupportedType =>
      (SUPPORTED_TYPES as readonly string[]).includes(t) && read.file[`${HELP_PREFIX}${t}`]?.enabled === true);
    if (types.length === 0) { skipped[name] = "no enabled help type in help_types that the runner supports"; continue; }

    for (const type of types) {
      const help = read.file[`${HELP_PREFIX}${type}`]!;
      const left = allowance(effectiveLimits(read.file, type), help.limits ?? {}, type, login, past, now);
      if (left.left <= 0) { skipped[`${name} ${type}`] = left.reason; continue; }
      const [kind, value] = [help.scope?.split(":")[0], help.scope?.slice(help.scope.indexOf(":") + 1)];
      if (type === "audit") {
        if (kind === "path") return { task: { target, type, left: left.left }, skipped };
      } else if (type === "pr") {
        // Skip an issue an agent pull request already claims (spec obligation 5).
        const claimed = new Set(openPulls.filter((p) => markerType(p.body)).flatMap((p) =>
          [...(p.body ?? "").matchAll(/#(\d+)/g)].map((m) => Number(m[1]))));
        const issue = kind === "label" ? openIssues.find((i) => i.labels.some((l) => l.name === value) && !claimed.has(i.number)) : undefined;
        if (issue) return { task: { target, type, left: left.left, issue }, skipped };
      } else {
        for (const p of kind === "label" ? openPulls.filter((p) => p.labels.some((l) => l.name === value) && p.user?.login !== login) : []) {
          const reviews = await gh.reviews(name, p.number);
          if (!reviews.some((r) => r.user?.login === login && markerType(r.body))) return { task: { target, type, left: left.left, pull: p }, skipped };
        }
      }
      skipped[`${name} ${type}`] = `no task in scope ${help.scope}`;
    }
  }
  return { skipped };
}

/**
 * A fresh checkout of the default branch at a known commit, which submit compares against.
 * Dependencies are installed without install scripts, because an agent's sandbox may have no
 * network and needs them to run the checks.
 */
function checkout(name: string, dir: string, notes: string[]): void {
  execFileSync("git", ["clone", "--quiet", "--depth", "50", `https://github.com/${name}.git`, dir], { stdio: "ignore" });
  if (existsSync(join(dir, "package-lock.json"))) {
    try {
      execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--silent"], { cwd: dir, stdio: "ignore", timeout: 600_000 });
    } catch {
      notes.push(`npm ci failed in ${name}; the agent works without dependencies.`);
    }
  }
}

/**
 * Checks out the task's repository and saves the task, with the prompt the agent gets.
 * `replyInFile`: the agent writes its JSON to a file (it drives the runner itself), instead of
 * replying with it (the runner launched it, and its sandbox may not write outside the checkout).
 */
export async function prepare(ctx: Context, p: Pick, replyInFile: boolean): Promise<TaskState> {
  const { repo, file, notes, items } = p.target;
  const name = repo.full_name;
  const help = file[`${HELP_PREFIX}${p.type}`]!;
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${p.type}`;
  const base = join(WORK, id);
  const dir = join(base, "repo");
  mkdirSync(base, { recursive: true });
  checkout(name, dir, ctx.notes);
  // The agent's reply lives outside the checkout, so it is never part of the change.
  const replyFile = join(base, "reply.json");
  const replyTarget = replyInFile ? replyFile : undefined;
  const forbidden = effectiveForbiddenPaths(file, p.type);
  const scope = help.scope ?? "";
  const state: TaskState = {
    id, type: p.type, repo: name, dir, baseSha: git(dir, "rev-parse", "HEAD").trim(), defaultBranch: repo.default_branch,
    pushAccess: repo.permissions?.push === true, scope, forbidden, maxDiffLines: help.max_diff_lines, require: help.require ?? [],
    prompt: "", replyFile, runnerRepo: ctx.runnerRepo, login: ctx.login, vendor: ctx.vendor, forced: ctx.forced, dryRun: ctx.dryRun,
  };
  if (p.type === "audit") {
    state.max = Math.min(p.left, 5);
    state.openTitles = items.filter((i) => i.state === "open" && !i.pull_request).map((i) => i.title);
    state.prompt = auditPrompt({ dir: scope.slice(scope.indexOf(":") + 1), max: state.max, openTitles: state.openTitles, notes, replyFile: replyTarget });
  } else if (p.type === "pr") {
    const issue = p.issue!;
    state.issue = { number: issue.number, title: issue.title };
    state.branch = `agents-contributing/issue-${issue.number}`;
    git(dir, "checkout", "-q", "-b", state.branch);
    state.prompt = fixPrompt({
      issue: { number: issue.number, title: issue.title, body: issue.body ?? "" },
      forbidden, maxDiffLines: help.max_diff_lines, require: state.require, notes, replyFile: replyTarget,
    });
  } else {
    const pull = p.pull!;
    state.pull = { number: pull.number };
    const diff = await ctx.gh.pullDiff(name, pull.number);
    state.prompt = reviewPrompt({ number: pull.number, title: pull.title, body: pull.body ?? "", diff, notes, replyFile: replyTarget });
  }
  writeFileSync(join(base, "task.json"), JSON.stringify(state, null, 2));
  return state;
}

export function loadTask(id: string): TaskState {
  const path = join(WORK, id, "task.json");
  if (!existsSync(path)) throw new Error(`No prepared task "${id}" in ${WORK}.`);
  return JSON.parse(readFileSync(path, "utf8")) as TaskState;
}

/** Re-reads the file right before submitting: the owner may have changed or removed it. */
async function stillAllowed(gh: GitHub, t: TaskState): Promise<string | null> {
  const now = await readFile(gh, t.repo);
  if (typeof now === "string") return now;
  const h = now.file[`${HELP_PREFIX}${t.type}`];
  if (!h?.enabled) return `help_${t.type} is no longer enabled`;
  if (h.scope !== t.scope) return `help_${t.type} changed its scope to ${h.scope}`;
  return null;
}

async function log(gh: GitHub, cfg: ContributorConfig, t: TaskState, url: string, model: string): Promise<void> {
  if (!cfg.log) return;
  const line = JSON.stringify({
    v: 1, type: t.type, repo: t.repo, url, provider: t.vendor, model, runner: VERSION, at: new Date().toISOString(),
    ...(t.forced ? { forced: true } : {}),
  });
  if (t.dryRun) {
    appendFileSync(join(HOME, "dry-run-contributions.jsonl"), line + "\n");
    return;
  }
  await gh.appendLine(t.runnerRepo, "contributions.jsonl", line, `Log ${t.type} contribution to ${t.repo}`);
}

/** Checks the agent's work against the rules, then submits it with the marker, and logs it. */
export async function submit(
  cfg: ContributorConfig, gh: GitHub, t: TaskState, reply: string, model: string, notes: string[],
): Promise<Record<string, unknown>> {
  const marker = contributionMarker({ type: t.type, provider: t.vendor, model, runner: VERSION, from: t.runnerRepo });
  const out: Record<string, unknown> = { task: t.id, repo: t.repo, type: t.type, model };

  if (t.type === "audit") {
    if (git(t.dir, "status", "--porcelain").trim()) return { ...out, rejected: ["An audit must not change files."] };
    const known = new Set((t.openTitles ?? []).map((x) => x.trim().toLowerCase()));
    const findings = parseFindings(reply, t.max ?? 5).filter((f) => !known.has(f.title.toLowerCase()));
    if (findings.length === 0) return { ...out, submitted: [], reason: "the audit found nothing new" };
    const why = await stillAllowed(gh, t);
    if (why) return { ...out, aborted: why };
    const submitted: string[] = [];
    const dir = t.scope.slice(t.scope.indexOf(":") + 1);
    for (const f of findings) {
      const body = `${f.body}\n\n---\nFound by an AI agent auditing \`${dir}\` under AGENTS-CONTRIBUTING.md.\n\n${marker}`;
      if (t.dryRun) { submitted.push(`(dry run) issue: ${f.title}`); notes.push(`Would open issue "${f.title}":\n${body}`); }
      else submitted.push((await gh.createIssue(t.repo, f.title, body)).html_url);
      await log(gh, cfg, t, submitted.at(-1)!, model);
    }
    return { ...out, submitted };
  }

  if (t.type === "pr") {
    const fix = parseFix(reply);
    if ("skip" in fix) return { ...out, issue: t.issue!.number, skipped: fix.skip };
    git(t.dir, "add", "-A");
    // Compare with the commit prepare checked out, so commits the agent made are counted too.
    const changes = parseNumstat(git(t.dir, "diff", "--cached", "--numstat", t.baseSha));
    const errors = checkChange(changes, { forbidden: t.forbidden, maxDiffLines: t.maxDiffLines, require: t.require });
    if (errors.length) return { ...out, issue: t.issue!.number, rejected: errors };
    const why = await stillAllowed(gh, t);
    if (why) return { ...out, aborted: why };
    const body = [
      fix.summary, `Closes #${t.issue!.number}`,
      "---\nThis pull request was written by an AI agent under this repository's AGENTS-CONTRIBUTING.md. " +
        "The runner checked its scope, forbidden paths, size and required tests before opening it.",
      marker,
    ].join("\n\n");
    const stat = changes.map((c) => `${c.path} +${c.added} -${c.deleted}`);
    if (t.dryRun) {
      notes.push(`Would open a draft pull request "${fix.title}" from ${t.branch}:\n${body}\n\n${git(t.dir, "diff", "--cached", t.baseSha)}`);
      await log(gh, cfg, t, "(dry run)", model);
      return { ...out, issue: t.issue!.number, changes: stat, submitted: ["(dry run) draft pull request"] };
    }
    // One commit on top of the base, whatever the agent did in between.
    git(t.dir, "reset", "-q", "--soft", t.baseSha);
    git(t.dir, "-c", `user.name=${t.login}`, "-c", `user.email=${t.login}@users.noreply.github.com`,
      "commit", "-q", "-m", `${fix.title}\n\nCloses #${t.issue!.number}\n\nAgents-Contributing: ${marker.replace(/^agents-contributing: /, "")}`);
    let head = t.branch!;
    let pushTo = t.repo;
    if (!t.pushAccess) {
      pushTo = (await gh.fork(t.repo)).full_name;
      head = `${pushTo.split("/")[0]}:${t.branch}`;
    }
    execFileSync("git", ["push", "-q", `https://github.com/${pushTo}.git`, `HEAD:refs/heads/${t.branch}`],
      { cwd: t.dir, env: gh.gitAuthEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const pr = await gh.createPull(t.repo, { title: fix.title, body, head, base: t.defaultBranch });
    await log(gh, cfg, t, pr.html_url, model);
    return { ...out, issue: t.issue!.number, changes: stat, submitted: [pr.html_url] };
  }

  if (git(t.dir, "status", "--porcelain").trim()) return { ...out, rejected: ["A review must not change files."] };
  const why = await stillAllowed(gh, t);
  if (why) return { ...out, aborted: why };
  const body = `${parseReview(reply)}\n\n---\nReview by an AI agent under this repository's AGENTS-CONTRIBUTING.md.\n\n${marker}`;
  if (t.dryRun) {
    notes.push(`Would review #${t.pull!.number}:\n${body}`);
    await log(gh, cfg, t, "(dry run)", model);
    return { ...out, pull: t.pull!.number, submitted: ["(dry run) review"] };
  }
  const r = await gh.review(t.repo, t.pull!.number, body);
  await log(gh, cfg, t, r.html_url, model);
  return { ...out, pull: t.pull!.number, submitted: [r.html_url] };
}
