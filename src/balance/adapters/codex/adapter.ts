import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { toDate, type Adapter, type Billing, type UsageReading, type UsageWindow } from "../../types.ts";
import { codexAgent } from "./agent.ts";

type RateWindow = { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown };
type RateLimits = {
  primary?: RateWindow | null;
  secondary?: RateWindow | null;
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: unknown } | null;
  rate_limit_reached_type?: string | null;
};

/** Window names shared with other adapters, so budget.window means the same everywhere. */
function windowName(minutes: number): string {
  if (minutes === 300) return "five_hour";
  if (minutes === 10080) return "seven_day";
  return `${minutes}_minutes`;
}

/**
 * Reads a Codex session file (`$CODEX_HOME/sessions/.../rollout-*.jsonl`). After each turn
 * Codex writes an event_msg of type token_count whose payload.rate_limits holds
 * primary and secondary windows {used_percent (0 to 100), window_minutes, resets_at (epoch
 * seconds)} and credits {has_credits, unlimited, balance}.
 */
export function parseRollout(content: string): { windows: UsageWindow[]; billing?: Billing } {
  let limits: RateLimits | undefined;
  for (const line of content.split("\n")) {
    if (!line.includes("rate_limits")) continue;
    try {
      const rec = JSON.parse(line) as { type?: string; payload?: { type?: string; rate_limits?: RateLimits } };
      if (rec.type === "event_msg" && rec.payload?.type === "token_count" && rec.payload.rate_limits) {
        limits = rec.payload.rate_limits; // the last is newest
      }
    } catch {
      // not JSON
    }
  }
  const windows: UsageWindow[] = [];
  for (const w of [limits?.primary, limits?.secondary]) {
    const minutes = w?.window_minutes;
    const used = w?.used_percent;
    const resetsAt = toDate(w?.resets_at);
    if (!resetsAt || typeof minutes !== "number" || typeof used !== "number" || !(used >= 0 && used <= 100)) continue;
    windows.push({ name: windowName(minutes), usedPct: Math.round(used * 10) / 10, resetsAt });
  }
  // Codex credits are bought. Once a plan limit is reached, requests spend them: paid usage.
  const c = limits?.credits;
  const billing = limits?.rate_limit_reached_type && (c?.has_credits || c?.unlimited) ? {
    pool: "credits",
    label: "Codex credits",
    checkHint: "Check the Codex usage page in ChatGPT.",
    expiresAt: null,
    allowed: true,
    overage: true,
  } : undefined;
  return { windows, billing };
}

export const CODEX_BIN = process.env.AGENTS_CONTRIBUTING_CODEX_BIN ?? "codex";
export const codexHome = () => process.env.CODEX_HOME ?? join(homedir(), ".codex");

/** Finds the session file of a thread, newest folders first. */
export function findRollout(dir: string, threadId: string): string | null {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir).sort().reverse()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      const found = findRollout(path, threadId);
      if (found) return found;
    } else if (name.endsWith(`${threadId}.jsonl`)) {
      return path;
    }
  }
  return null;
}

/**
 * Runs one tiny headless turn (`codex exec`, read-only sandbox, low effort, no user config)
 * and reads the limits Codex saved for it. `codex exec --json` itself does not print them.
 */
function probe(now: Date): UsageReading {
  let output: string;
  try {
    output = execFileSync(CODEX_BIN, [
      "exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only",
      "--ignore-user-config", "--ignore-rules", "-c", 'model_reasoning_effort="low"', "Reply with: ok",
    ], { cwd: tmpdir(), encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(`Could not run "${CODEX_BIN} exec" to read usage: ${(e as Error).message.split("\n")[0]}`);
  }
  const threadId = /"thread_id":"([^"]+)"/.exec(output)?.[1];
  if (!threadId) throw new Error("codex exec did not report a thread id.");
  const file = findRollout(join(codexHome(), "sessions"), threadId);
  if (!file) throw new Error(`No Codex session file for thread ${threadId}.`);
  const { windows, billing } = parseRollout(readFileSync(file, "utf8"));
  if (windows.length === 0 && !billing) {
    throw new Error("Codex reported no usage windows. Usage is only exposed when signed in with ChatGPT.");
  }
  return { provider: "codex", source: file, capturedAt: now, windows, billing };
}

/**
 * When the check runs inside Codex (a routine or automation calling the runner), the current
 * session already saved the limits: read them from its file. Launching a second Codex from
 * inside the first one's sandbox fails, and would cost a turn.
 */
function ownSession(now: Date): UsageReading | null {
  const threadId = process.env.CODEX_THREAD_ID;
  const file = threadId ? findRollout(join(codexHome(), "sessions"), threadId) : null;
  if (!file) return null;
  const { windows, billing } = parseRollout(readFileSync(file, "utf8"));
  return windows.length > 0 ? { provider: "codex", source: file, capturedAt: now, windows, billing } : null;
}

/** Codex CLI: reads the limits from the current Codex session, or from a tiny headless turn. */
export const codex: Adapter = {
  name: "codex",
  read(_cfg, now) {
    return ownSession(now) ?? probe(now);
  },
  agent: codexAgent,
};
