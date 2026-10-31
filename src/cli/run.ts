#!/usr/bin/env -S npx tsx
/**
 * The contribution runner. Each call makes at most one contribution.
 *
 *   run.ts [--dry-run] [--force] [config]
 *       Picks a task, launches the provider's agent on it, checks and submits the result.
 *       For schedulers that only run commands, such as GitHub Actions.
 *
 *   run.ts next [--dry-run] [--force] [config]
 *       For an agent that is already running, such as a routine. Picks a task, checks out the
 *       repository, and prints the task: what to do, where, and where to write the reply.
 *   run.ts submit <task id> --model <model> [config]
 *       Checks what the agent did against the rules, then submits it and logs it.
 *
 *   --dry-run  do everything except writing to GitHub; print what would be submitted
 *   --force    contribute even when the balance check says not to (recorded in the output and log)
 *
 * Writing needs AGENTS_CONTRIBUTING_GITHUB_TOKEN: a classic token with only the public_repo
 * scope. Without it every run is a dry run. Exit codes: 0 done, 10 nothing to do, 2 error.
 */
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_CONFIG_PATH, loadConfig } from "../balance/config.ts";
import { ADAPTERS } from "../balance/adapters/index.ts";
import { GitHub } from "../runner/github.ts";
import { loadTask, pick, prepare, setup, submit } from "../runner/flow.ts";

const args = process.argv.slice(2);
const take = (f: string, withValue = false): string | boolean | undefined => {
  const i = args.indexOf(f);
  if (i < 0) return undefined;
  const [, value] = args.splice(i, withValue ? 2 : 1);
  return withValue ? value : true;
};
const mode = args[0] === "next" || args[0] === "submit" ? args.shift()! : "launch";
const taskId = mode === "submit" ? args.shift() : undefined;
const force = take("--force") === true;
const dryRunFlag = take("--dry-run") === true;
const model = take("--model", true);
const token = process.env.AGENTS_CONTRIBUTING_GITHUB_TOKEN?.trim() || null;
const cfg = loadConfig(args[0] ?? DEFAULT_CONFIG_PATH);
const notes: string[] = [];

function finish(code: number, result: Record<string, unknown>): never {
  const all = [...notes, ...((result.notes as string[] | undefined) ?? [])];
  console.log(JSON.stringify({ mode, ...result, notes: all }, null, 2));
  process.exit(code);
}

async function main(): Promise<void> {
  if (mode === "submit") {
    if (!taskId) throw new Error("Usage: run.ts submit <task id> --model <model>");
    const t = loadTask(taskId);
    if (!existsSync(t.replyFile)) throw new Error(`No reply at ${t.replyFile}. Write the JSON the task asked for there first.`);
    const gh = new GitHub(t.dryRun ? null : token);
    if (!t.dryRun && !token) throw new Error("This task was prepared for a real run; AGENTS_CONTRIBUTING_GITHUB_TOKEN is missing.");
    const done = await submit(cfg, gh, t, readFileSync(t.replyFile, "utf8"), typeof model === "string" ? model : "unknown", notes);
    finish(done.rejected || done.aborted ? 2 : 0, { dry_run: t.dryRun, forced: t.forced, ...done });
  }

  const ready = await setup(cfg, token, { dryRun: dryRunFlag, force });
  if (ready.stop) finish(ready.stop.code, ready.stop.result);
  const ctx = ready.ctx!;
  notes.push(...ctx.notes);
  ctx.notes = notes;
  const found = await pick(ctx);
  if (!found.task) finish(10, { result: "nothing-to-do", skipped: found.skipped });

  if (mode === "next") {
    const t = await prepare(ctx, found.task, true);
    finish(0, {
      result: "task", dry_run: t.dryRun, forced: t.forced, task: t.id, type: t.type, repo: t.repo, dir: t.dir,
      instructions: `Work in ${t.dir}. ${t.prompt}`,
      then: `run.ts submit ${t.id} --model <the model you are>`,
    });
  }

  const agent = ADAPTERS[cfg.provider]?.agent;
  if (!agent) throw new Error(`The "${cfg.provider}" provider cannot be launched by the runner. Use "run.ts next" from the agent instead.`);
  const t = await prepare(ctx, found.task, false);
  const res = agent.run({ cwd: t.dir, prompt: t.prompt, write: t.type === "pr" });
  const done = await submit(cfg, ctx.gh, t, res.text, res.model, notes);
  finish(done.rejected || done.aborted ? 2 : 0, { dry_run: t.dryRun, forced: t.forced, balance_forced: force, ...done });
}

main().catch((e) => finish(2, { result: "error", reason: (e as Error).message }));
