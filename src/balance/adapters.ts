import { existsSync, readFileSync } from "node:fs";
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

/**
 * Claude Code: reads the cache written by statusline-capture.ts.
 * Claude Code passes rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}
 * to the statusLine command on subscription plans. The fields can be missing.
 */
export const claudeCode: Adapter = {
  name: "claude-code",
  read(_cfg, now) {
    if (!existsSync(CLAUDE_CACHE)) {
      throw new Error(
        `No usage cache at ${CLAUDE_CACHE}. Install the statusLine capture (see skills/check-balance/SKILL.md) and use Claude Code once.`,
      );
    }
    const cache = JSON.parse(readFileSync(CLAUDE_CACHE, "utf8")) as {
      captured_at?: unknown;
      rate_limits?: Record<string, { used_percentage?: unknown; resets_at?: unknown }>;
    };
    const capturedAt = toDate(cache.captured_at) ?? new Date(0);
    const windows: UsageWindow[] = [];
    for (const [name, w] of Object.entries(cache.rate_limits ?? {})) {
      const resetsAt = toDate(w?.resets_at);
      const used = Number(w?.used_percentage);
      if (!resetsAt || !Number.isFinite(used)) continue;
      // A window that reset after the capture is fresh again: we know nothing about it.
      windows.push({ name, usedPct: resetsAt <= now ? null : used, resetsAt });
    }
    if (windows.length === 0) throw new Error("The usage cache has no rate_limits windows.");
    return { provider: "claude-code", source: CLAUDE_CACHE, capturedAt, windows };
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
