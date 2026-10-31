import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import type { Adapter } from "../types.ts";
import { claudeCode } from "./claude-code/adapter.ts";
import { codex } from "./codex/adapter.ts";
import { declared } from "./declared/adapter.ts";

/**
 * Every provider adapter, by the name used in contributor.yml. Adding a provider is one folder
 * and one line here; test/adapters.test.ts fails until both exist and match.
 */
export const ADAPTERS: Record<string, Adapter> = {
  [claudeCode.name]: claudeCode,
  [codex.name]: codex,
  [declared.name]: declared,
};

/** Used for any agent that no adapter detects: it works with no usage reading at all. */
export const FALLBACK = declared;

/** The names of this process's ancestors, nearest first. Empty where `ps` is unavailable. */
export function ancestorNames(): string[] {
  const names: string[] = [];
  let pid = process.ppid;
  // Down to pid 1 inclusive: inside a sandbox's own process namespace, the agent's sandbox
  // process is pid 1 (Codex runs commands under codex-linux-sandbox).
  for (let i = 0; i < 30 && pid >= 1; i++) {
    try {
      const [ppid, ...comm] = execFileSync("ps", ["-o", "ppid=", "-o", "args=", "-p", String(pid)], { encoding: "utf8" }).trim().split(/\s+/);
      // The command itself, or the script a runtime such as node is running.
      for (const part of comm.slice(0, 2)) names.push(basename(part));
      if (pid === 1) break;
      pid = Number(ppid);
    } catch {
      break;
    }
  }
  return names;
}

/**
 * The adapter of the agent the runner is called from, or the fallback. When several agents'
 * environments are present (one agent running inside another), the nearest in the process
 * tree wins.
 */
export function detectAdapter(env: NodeJS.ProcessEnv = process.env, ancestors: () => string[] = ancestorNames): Adapter {
  const found = Object.values(ADAPTERS).filter((a) => a.detect?.(env));
  if (found.length <= 1) return found[0] ?? FALLBACK;
  const tree = ancestors();
  const nearest = (a: Adapter) => {
    // A process name matches exactly or as a prefix, so "codex" also matches codex-linux-sandbox.
    const i = tree.findIndex((n) => a.processNames?.some((p) => n === p || n.startsWith(`${p}-`)));
    return i < 0 ? Infinity : i;
  };
  return [...found].sort((x, y) => nearest(x) - nearest(y))[0]!;
}
