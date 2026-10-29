import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextWeekly, parseProbeOutput } from "../src/balance/adapters.ts";
import { decide } from "../src/balance/decide.ts";
import type { ContributorConfig } from "../src/balance/config.ts";
import type { UsageReading } from "../src/balance/adapters.ts";

const cfg: ContributorConfig = {
  version: 1,
  provider: "claude-code",
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

// A real rate_limit_event line from `claude -p --output-format stream-json --verbose`.
const PROBE_OUTPUT = [
  '{"type":"system","subtype":"init"}',
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1793865600,"rateLimitType":"ccr_promotional","overageStatus":"rejected","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":0.6,"resetsAt":1793305200,"status":"allowed"},"seven_day":{"utilization":0.14,"resetsAt":1793415600,"status":"allowed"}}},"uuid":"x","session_id":"y"}',
  '{"type":"result","subtype":"success"}',
].join("\n");

test("parseProbeOutput reads both windows as percentages", () => {
  const w = parseProbeOutput(PROBE_OUTPUT).windows;
  assert.deepEqual(w.map((x) => [x.name, x.usedPct, x.resetsAt.toISOString()]), [
    ["five_hour", 60, "2026-10-29T20:20:00.000Z"],
    ["seven_day", 14, "2026-10-31T03:00:00.000Z"],
  ]);
});

test("parseProbeOutput ignores output without usage", () => {
  assert.deepEqual(parseProbeOutput('{"type":"result"}\nnot json'), { windows: [], billing: undefined });
});

test("parseProbeOutput sees cloud credits as the billing pool", () => {
  const b = parseProbeOutput(PROBE_OUTPUT).billing;
  assert.equal(b?.pool, "ccr_promotional");
  assert.equal(b?.expiresAt?.toISOString(), "2026-11-05T08:00:00.000Z");
  assert.equal(b?.allowed, true);
  assert.equal(b?.overage, false);
});

test("a subscription window type is not a separate billing pool", () => {
  const line = PROBE_OUTPUT.replace('"rateLimitType":"ccr_promotional"', '"rateLimitType":"seven_day"');
  assert.equal(parseProbeOutput(line).billing, undefined);
});

const credits = (expiresIn: number, extra: Partial<NonNullable<UsageReading["billing"]>> = {}) => ({
  ...reading(40, 10),
  billing: { pool: "ccr_promotional", expiresAt: hours(expiresIn), allowed: true, overage: false, ...extra },
});

test("cloud credits far from expiry: skip, even with a weekly surplus near its reset", () => {
  const d = decide(cfg, credits(200), now);
  assert.equal(d.verdict, "skip");
  assert.match(d.reason, /cloud credits/);
  assert.equal(d.notify, undefined);
});

test("cloud credits within lead_days: contribute up to the daily cap", () => {
  const d = decide(cfg, credits(60), now, 2.5);
  assert.equal(d.verdict, "contribute-until-limited");
  assert.equal(d.window, "ccr_promotional");
  assert.equal(d.max_spend_usd, 15);
  assert.equal(d.spent_usd, 2.5);
});

test("cloud credits: stop once the run reaches the daily cap", () => {
  const d = decide(cfg, credits(60), now, 15.2);
  assert.equal(d.verdict, "skip");
  assert.match(d.reason, /daily cap/);
});

test("cloud credits: remind the owner once, a week before they expire", () => {
  assert.match(decide(cfg, credits(6.5 * 24), now).notify ?? "", /expire on .*\/usage/);
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

test("check-balance probes Claude Code with no config", () => {
  const home = mkdtempSync(join(tmpdir(), "ac-"));
  const fake = join(home, "claude");
  const now = Math.floor(Date.now() / 1000);
  const event = { type: "rate_limit_event", rate_limit_info: { unifiedWindows: {
    five_hour: { utilization: 0.2, resetsAt: now + 7200 },
    seven_day: { utilization: 0.4, resetsAt: now + 10 * 3600 },
  } } };
  writeFileSync(fake, `#!/bin/sh\necho '${JSON.stringify(event)}'\n`, { mode: 0o755 });
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli/check-balance.ts"], {
    encoding: "utf8",
    env: { ...process.env, AGENTS_CONTRIBUTING_HOME: home, AGENTS_CONTRIBUTING_CLAUDE_BIN: fake },
  });
  const out = JSON.parse(r.stdout);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(out.verdict, "contribute");
  assert.equal(out.used_pct, 40);
  assert.equal(out.stop_at_used_pct, 90);
});
