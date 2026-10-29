import { test } from "node:test";
import assert from "node:assert/strict";
import { nextWeekly } from "../src/balance/adapters.ts";
import { decide } from "../src/balance/decide.ts";
import type { ContributorConfig } from "../src/balance/config.ts";
import type { UsageReading } from "../src/balance/adapters.ts";

const cfg: ContributorConfig = {
  version: 1,
  provider: "claude-code",
  targets: { repos: [], topics: ["agents-contributing"] },
  help_types: ["reproduce"],
  budget: { window: "seven_day", lead_hours: 24, margin_pct: 10, donate_fraction: 1, min_surplus_pct: 5 },
  declared: { timezone: "UTC", weekly_reset: "sun 00:00" },
  log: true,
};

const now = new Date("2026-10-29T12:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

function reading(sevenDay: number | null, resetIn: number, fiveHour: number | null = 10): UsageReading {
  return {
    provider: "claude-code", source: "test", capturedAt: now,
    windows: [
      { name: "five_hour", usedPct: fiveHour, resetsAt: hours(2) },
      { name: "seven_day", usedPct: sevenDay, resetsAt: hours(resetIn) },
    ],
  };
}

test("skip when the reset is far away", () => {
  assert.equal(decide(cfg, reading(30, 72), now).verdict, "skip");
});

test("contribute near the reset with surplus, and stop before the margin", () => {
  const d = decide(cfg, reading(40, 10), now);
  assert.equal(d.verdict, "contribute");
  assert.equal(d.donate_pct, 50);
  assert.equal(d.stop_at_used_pct, 90);
});

test("donate_fraction limits the donation", () => {
  const d = decide({ ...cfg, budget: { ...cfg.budget, donate_fraction: 0.5 } }, reading(40, 10), now);
  assert.equal(d.donate_pct, 25);
  assert.equal(d.stop_at_used_pct, 65);
});

test("skip when the surplus is too small", () => {
  assert.equal(decide(cfg, reading(88, 10), now).verdict, "skip");
});

test("skip when the short window is full", () => {
  const d = decide(cfg, reading(40, 10, 95), now);
  assert.equal(d.verdict, "skip");
  assert.match(d.reason, /five_hour/);
});

test("unknown usage inside the lead window means contribute until limited", () => {
  assert.equal(decide(cfg, reading(null, 10, null), now).verdict, "contribute-until-limited");
});

test("nextWeekly finds the next Sunday midnight in UTC", () => {
  assert.equal(nextWeekly("sun 00:00", "UTC", now).toISOString(), "2026-11-01T00:00:00.000Z");
});

test("nextWeekly respects the time zone", () => {
  // Asia/Jerusalem is UTC+2 after the October DST change.
  assert.equal(nextWeekly("sun 09:00", "Asia/Jerusalem", now).toISOString(), "2026-11-01T07:00:00.000Z");
});

test("nextWeekly rolls over to next week when the time has passed", () => {
  assert.equal(nextWeekly("thu 11:00", "UTC", now).toISOString(), "2026-11-05T11:00:00.000Z");
});
