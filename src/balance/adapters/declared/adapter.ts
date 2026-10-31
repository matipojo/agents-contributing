import type { Adapter } from "../../types.ts";

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
  // The fallback for any agent without an adapter of its own: it never detects itself.
  vendor: "unknown",
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
