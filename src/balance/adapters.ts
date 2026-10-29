import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOME, type ContributorConfig } from "./config.ts";

/** One usage window as reported by a provider. */
export interface UsageWindow {
  name: string;
  usedPct: number | null;   // null when the provider does not expose usage
  resetsAt: Date;
}

export interface UsageReading {
  provider: string;
  source: string;           // where the numbers came from
  capturedAt: Date;
  windows: UsageWindow[];
}

export interface Adapter {
  name: string;
  read(cfg: ContributorConfig, now: Date): UsageReading;
}

export const CLAUDE_CACHE = join(HOME, "claude-usage.json");

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

/** Status line readings older than this are not used; the probe runs instead. */
const CACHE_MAX_AGE_MINUTES = 30;

/** Reads the cache written by statusline-capture.ts, or null if it is missing, old or empty. */
function readStatusLineCache(now: Date): UsageReading | null {
  if (!existsSync(CLAUDE_CACHE)) return null;
  let cache: { captured_at?: unknown; rate_limits?: Record<string, { used_percentage?: unknown; resets_at?: unknown }> };
  try {
    cache = JSON.parse(readFileSync(CLAUDE_CACHE, "utf8"));
  } catch {
    return null;
  }
  const capturedAt = toDate(cache.captured_at);
  if (!capturedAt || now.getTime() - capturedAt.getTime() > CACHE_MAX_AGE_MINUTES * 60000) return null;
  const windows: UsageWindow[] = [];
  for (const [name, w] of Object.entries(cache.rate_limits ?? {})) {
    const resetsAt = toDate(w?.resets_at);
    const used = Number(w?.used_percentage);
    if (!resetsAt || !Number.isFinite(used)) continue;
    // A window that reset after the capture is fresh again: we know nothing about it.
    windows.push({ name, usedPct: resetsAt <= now ? null : used, resetsAt });
  }
  if (windows.length === 0) return null;
  return { provider: "claude-code", source: CLAUDE_CACHE, capturedAt, windows };
}

/**
 * Reads usage windows from `claude -p --output-format stream-json --verbose` output.
 * Claude Code emits a rate_limit_event whose rate_limit_info.unifiedWindows holds
 * {five_hour, seven_day}.{utilization (0 to 1), resetsAt (epoch seconds)}.
 */
export function parseRateLimitEvent(output: string): UsageWindow[] {
  let windows: UsageWindow[] = [];
  for (const line of output.split("\n")) {
    if (!line.includes("rate_limit_event")) continue;
    let event: { type?: string; rate_limit_info?: { unifiedWindows?: Record<string, { utilization?: unknown; resetsAt?: unknown }> } };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "rate_limit_event") continue;
    const found: UsageWindow[] = [];
    for (const [name, w] of Object.entries(event.rate_limit_info?.unifiedWindows ?? {})) {
      const resetsAt = toDate(w?.resetsAt);
      const used = Number(w?.utilization);
      if (!resetsAt || !Number.isFinite(used)) continue;
      found.push({ name, usedPct: Math.round(used * 1000) / 10, resetsAt });
    }
    if (found.length > 0) windows = found; // the last event is the newest
  }
  return windows;
}

/** The command for the probe. Override with AGENTS_CONTRIBUTING_CLAUDE_BIN. */
const CLAUDE_BIN = process.env.AGENTS_CONTRIBUTING_CLAUDE_BIN ?? "claude";

/**
 * Asks Claude Code for the current limits with the smallest possible request: a cheap model,
 * no tools, no MCP servers and no saved session. Works headless, for example in a scheduled
 * routine, where no status line is ever drawn.
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
    if (parseRateLimitEvent(output).length === 0) {
      throw new Error(`Could not run "${CLAUDE_BIN} -p" to read usage: ${err.message.split("\n")[0]}`);
    }
  }
  const windows = parseRateLimitEvent(output);
  if (windows.length === 0) {
    throw new Error("Claude Code reported no usage windows. Usage is only exposed on subscription plans.");
  }
  return { provider: "claude-code", source: `${CLAUDE_BIN} -p`, capturedAt: now, windows };
}

/**
 * Claude Code: uses a fresh status line reading when there is one (free), otherwise
 * runs a tiny headless request and reads the limits Claude Code reports for it.
 */
export const claudeCode: Adapter = {
  name: "claude-code",
  read(_cfg, now) {
    return readStatusLineCache(now) ?? probe(now);
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
