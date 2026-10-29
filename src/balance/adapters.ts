import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ContributorConfig } from "./config.ts";

/** One usage window as reported by a provider. */
export interface UsageWindow {
  name: string;
  usedPct: number | null;   // null when the provider does not expose usage
  resetsAt: Date;
}

/** What the current request is charged to, when that is not the subscription windows. */
export interface Billing {
  pool: string;             // e.g. "ccr_promotional": cloud session credits
  expiresAt: Date | null;   // when the pool expires or resets
  allowed: boolean;         // false when the provider refuses requests from this pool
  overage: boolean;         // true when paid extra usage is being spent
}

export interface UsageReading {
  provider: string;
  source: string;           // where the numbers came from
  capturedAt: Date;
  windows: UsageWindow[];
  billing?: Billing;        // absent when requests count against the windows
}

export interface Adapter {
  name: string;
  read(cfg: ContributorConfig, now: Date): UsageReading;
}

/** Accepts epoch seconds, epoch milliseconds or an ISO string. */
export function toDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return toDate(n);
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

type RateLimitInfo = {
  status?: string;
  resetsAt?: unknown;
  rateLimitType?: string;
  isUsingOverage?: boolean;
  unifiedWindows?: Record<string, { utilization?: unknown; resetsAt?: unknown }>;
};

/**
 * Reads `claude -p --output-format stream-json --verbose` output. Claude Code emits a
 * rate_limit_event whose rate_limit_info.unifiedWindows holds
 * {five_hour, seven_day}.{utilization (0 to 1), resetsAt (epoch seconds)}, and whose
 * rateLimitType names what the request was charged to. In a cloud session that can be
 * cloud credits ("ccr_promotional", resetsAt is their expiry), and then work does not
 * count against the windows at all.
 */
export function parseProbeOutput(output: string): { windows: UsageWindow[]; billing?: Billing } {
  let info: RateLimitInfo | undefined;
  for (const line of output.split("\n")) {
    if (!line.includes("rate_limit_event")) continue;
    try {
      const event = JSON.parse(line) as { type?: string; rate_limit_info?: RateLimitInfo };
      if (event.type === "rate_limit_event" && event.rate_limit_info) info = event.rate_limit_info; // the last is newest
    } catch {
      // not JSON
    }
  }
  const windows: UsageWindow[] = [];
  for (const [name, w] of Object.entries(info?.unifiedWindows ?? {})) {
    const resetsAt = toDate(w?.resetsAt);
    const used = Number(w?.utilization);
    if (!resetsAt || !Number.isFinite(used)) continue;
    windows.push({ name, usedPct: Math.round(used * 1000) / 10, resetsAt });
  }
  const type = info?.rateLimitType;
  // Window types such as "five_hour" or "seven_day_opus" mean the subscription pays.
  const subscription = !type || /^(five_hour|seven_day)/.test(type);
  const billing = !info || (subscription && !info.isUsingOverage) ? undefined : {
    pool: subscription ? "overage" : type!,
    expiresAt: toDate(info.resetsAt),
    allowed: info.status !== "rejected",
    overage: info.isUsingOverage === true,
  };
  return { windows, billing };
}

/** The command for the probe. Override with AGENTS_CONTRIBUTING_CLAUDE_BIN. */
const CLAUDE_BIN = process.env.AGENTS_CONTRIBUTING_CLAUDE_BIN ?? "claude";

/**
 * Asks Claude Code for the current limits with the smallest possible request: a cheap model,
 * no tools, no MCP servers and no saved session. Works headless, in a scheduled routine.
 */
function probe(now: Date): UsageReading {
  let output: string;
  try {
    output = execFileSync(CLAUDE_BIN, [
      "-p", "--output-format", "stream-json", "--verbose", "--max-turns", "1",
      "--model", "haiku", "--tools", "", "--strict-mcp-config", "--disable-slash-commands",
      "--no-session-persistence", "--system-prompt", "Reply with: ok", "ok",
    ], { cwd: tmpdir(), encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { stdout?: string; message: string };
    // A refused request still reports its limits, so parse what came back.
    output = err.stdout ?? "";
    if (parseProbeOutput(output).windows.length === 0) {
      throw new Error(`Could not run "${CLAUDE_BIN} -p" to read usage: ${err.message.split("\n")[0]}`);
    }
  }
  const { windows, billing } = parseProbeOutput(output);
  if (windows.length === 0) {
    throw new Error("Claude Code reported no usage windows. Usage is only exposed on subscription plans.");
  }
  return { provider: "claude-code", source: `${CLAUDE_BIN} -p`, capturedAt: now, windows, billing };
}

/** Claude Code: runs a tiny headless request and reads the limits Claude Code reports for it. */
export const claudeCode: Adapter = {
  name: "claude-code",
  read(_cfg, now) {
    return probe(now);
  },
};

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Offset in minutes of a time zone at a given instant, e.g. +120 for Asia/Jerusalem in winter. */
function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Next occurrence of "ddd HH:MM" in a time zone, strictly after `now`. */
export function nextWeekly(spec: string, timeZone: string, now: Date): Date {
  const m = /^([a-z]{3})\s+(\d{1,2}):(\d{2})$/i.exec(spec.trim());
  const day = m ? DAYS.indexOf(m[1]!.toLowerCase()) : -1;
  if (!m || day < 0) throw new Error(`declared.weekly_reset must look like "sun 09:00", got "${spec}"`);
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  const off = tzOffsetMinutes(timeZone, now);
  const local = new Date(now.getTime() + off * 60000); // wall clock in the zone, stored as UTC fields
  const candidate = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm));
  candidate.setUTCDate(candidate.getUTCDate() + ((day - local.getUTCDay() + 7) % 7));
  if (candidate.getTime() <= local.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 7);
  const guess = new Date(candidate.getTime() - off * 60000);
  // Correct for a DST change between now and the reset.
  return new Date(candidate.getTime() - tzOffsetMinutes(timeZone, guess) * 60000);
}

/**
 * Declared: for providers that do not expose usage. The contributor declares when the
 * weekly window resets, and the runner contributes until the provider refuses.
 */
export const declared: Adapter = {
  name: "declared",
  read(cfg, now) {
    const resetsAt = nextWeekly(cfg.declared.weekly_reset, cfg.declared.timezone, now);
    return {
      provider: "declared",
      source: "contributor.yml",
      capturedAt: now,
      windows: [{ name: cfg.budget.window, usedPct: null, resetsAt }],
    };
  },
};

export const ADAPTERS: Record<string, Adapter> = {
  [claudeCode.name]: claudeCode,
  [declared.name]: declared,
};

/**
 * What the current Claude Code session has spent, from the last "cost-state" record in its
 * transcript. Claude Code writes that record only now and then, so this can lag behind;
 * pass the live cost with --spent-usd when it is available.
 */
export function sessionSpendUsd(sessionId = process.env.CLAUDE_CODE_SESSION_ID): number | null {
  if (!sessionId) return null;
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  if (!existsSync(projects)) return null;
  for (const dir of readdirSync(projects)) {
    const file = join(projects, dir, `${sessionId}.jsonl`);
    if (!existsSync(file)) continue;
    let cost: number | null = null;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.includes('"cost-state"')) continue;
      try {
        const rec = JSON.parse(line) as { type?: string; totalCostUSD?: unknown };
        if (rec.type === "cost-state" && typeof rec.totalCostUSD === "number") cost = rec.totalCostUSD;
      } catch {
        // not JSON
      }
    }
    if (cost !== null) return Math.round(cost * 100) / 100;
  }
  return null;
}
