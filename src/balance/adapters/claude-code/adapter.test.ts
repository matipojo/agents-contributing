import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProbeOutput } from "./adapter.ts";

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
  assert.equal(b?.label, "Claude cloud session credits");
  assert.equal(b?.expiresAt?.toISOString(), "2026-11-05T08:00:00.000Z");
  assert.equal(b?.allowed, true);
  assert.equal(b?.overage, false);
});

test("a subscription window type is not a separate billing pool", () => {
  const line = PROBE_OUTPUT.replace('"rateLimitType":"ccr_promotional"', '"rateLimitType":"seven_day"');
  assert.equal(parseProbeOutput(line).billing, undefined);
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
