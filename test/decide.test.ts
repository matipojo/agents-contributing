// The decision logic is the same for every provider; these tests use made-up readings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/balance/decide.ts";
import type { ContributorConfig } from "../src/balance/config.ts";
import type { UsageReading } from "../src/balance/types.ts";

const cfg: ContributorConfig = {
  version: 1,
  provider: "test",
  targets: { repos: [], topics: ["agents-contributing"] },
  help_types: ["reproduce"],
  budget: { window: "seven_day", lead_hours: 24, margin_pct: 10, donate_fraction: 1, min_surplus_pct: 5 },
  donate: ["subscription", "credits"],
  credits: { lead_days: 3, daily_usd: 15, remind_days: 7 },
  declared: { timezone: "UTC", weekly_reset: "sun 00:00" },
  log: true,
};

const now = new Date("2026-10-29T12:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

function reading(sevenDay: number | null, resetIn: number, fiveHour: number | null = 10): UsageReading {
  return {
    provider: "test", source: "test", capturedAt: now,
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

const credits = (expiresIn: number, extra: Partial<NonNullable<UsageReading["billing"]>> = {}) => ({
  ...reading(40, 10),
  billing: { pool: "example_credits", label: "example credits", checkHint: "Check your account page.", expiresAt: hours(expiresIn), allowed: true, overage: false, ...extra },
});

test("credits far from expiry: skip, even with a weekly surplus near its reset", () => {
  const d = decide(cfg, credits(200), now);
  assert.equal(d.verdict, "skip");
  assert.match(d.reason, /example credits/);
  assert.equal(d.notify, undefined);
});

test("credits within lead_days: contribute up to the daily cap", () => {
  const d = decide(cfg, credits(60), now, 2.5);
  assert.equal(d.verdict, "contribute-until-limited");
  assert.equal(d.window, "example_credits");
  assert.equal(d.max_spend_usd, 15);
  assert.equal(d.spent_usd, 2.5);
});

test("credits: stop once the run reaches the daily cap", () => {
  const d = decide(cfg, credits(60), now, 15.2);
  assert.equal(d.verdict, "skip");
  assert.match(d.reason, /daily cap/);
});

test("credits: remind the owner once, a week before they expire", () => {
  assert.match(decide(cfg, credits(6.5 * 24), now).notify ?? "", /expire on .*account page/);
  assert.equal(decide(cfg, credits(5.5 * 24), now).notify, undefined);
  assert.equal(decide(cfg, credits(7.5 * 24), now).notify, undefined);
});

test("credits not in donate: skip, and the reminder says they will be lost", () => {
  const d = decide({ ...cfg, donate: ["subscription"] }, credits(6.5 * 24), now);
  assert.equal(d.verdict, "skip");
  assert.match(d.notify ?? "", /lost/);
  assert.equal(decide({ ...cfg, donate: ["subscription"] }, credits(12), now).verdict, "skip");
});

test("subscription not in donate: skip even with surplus", () => {
  assert.equal(decide({ ...cfg, donate: ["credits"] }, reading(40, 10), now).verdict, "skip");
});

test("never spend paid extra usage", () => {
  assert.equal(decide(cfg, credits(12, { overage: true }), now).verdict, "skip");
});

test("a pool that refuses requests means skip", () => {
  assert.equal(decide(cfg, credits(12, { allowed: false }), now).verdict, "skip");
});
