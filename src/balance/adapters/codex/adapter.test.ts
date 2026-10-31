import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRollout } from "./adapter.ts";

// A real token_count line from a Codex session file (ChatGPT Plus).
const LIMITS = {
  limit_id: "codex", limit_name: null,
  primary: { used_percent: 0.0, window_minutes: 300, resets_at: 1793327088 },
  secondary: { used_percent: 0.0, window_minutes: 10080, resets_at: 1793913888 },
  credits: { has_credits: false, unlimited: false, balance: "0" },
  individual_limit: null, spend_control_reached: null, plan_type: "plus", rate_limit_reached_type: null,
};
const line = (limits: object) =>
  JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null, rate_limits: limits } });
const ROLLOUT = ['{"type":"session_meta","payload":{}}', line(LIMITS), '{"type":"event_msg","payload":{"type":"task_complete"}}'].join("\n");

test("parseRollout maps primary and secondary to five_hour and seven_day", () => {
  const { windows, billing } = parseRollout(ROLLOUT);
  assert.deepEqual(windows.map((w) => [w.name, w.usedPct, w.resetsAt.toISOString()]), [
    ["five_hour", 0, "2026-10-30T02:24:48.000Z"],
    ["seven_day", 0, "2026-11-05T21:24:48.000Z"],
  ]);
  assert.equal(billing, undefined);
});

test("parseRollout ignores files without limits", () => {
  assert.deepEqual(parseRollout('{"type":"session_meta"}\nnot json'), { windows: [], billing: undefined });
});

test("spending bought credits after a plan limit counts as paid usage", () => {
  const b = parseRollout(line({ ...LIMITS, rate_limit_reached_type: "primary", credits: { has_credits: true, unlimited: false, balance: "12.5" } })).billing;
  assert.equal(b?.overage, true);
  assert.equal(b?.label, "Codex credits");
});

test("check-balance probes Codex through its session file", () => {
  const home = mkdtempSync(join(tmpdir(), "ac-"));
  const codexHome = join(home, "codex-home");
  const day = join(codexHome, "sessions", "2026", "10", "29");
  mkdirSync(day, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(join(day, "rollout-2026-10-29T00-00-00-thread-1.jsonl"), line({
    ...LIMITS,
    primary: { used_percent: 20, window_minutes: 300, resets_at: now + 7200 },
    secondary: { used_percent: 40, window_minutes: 10080, resets_at: now + 10 * 3600 },
  }));
  const fake = join(home, "codex");
  writeFileSync(fake, `#!/bin/sh\necho '{"type":"thread.started","thread_id":"thread-1"}'\n`, { mode: 0o755 });
  writeFileSync(join(home, "contributor.yml"), "provider: codex\n");
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli/check-balance.ts"], {
    encoding: "utf8",
    env: { ...process.env, AGENTS_CONTRIBUTING_HOME: home, AGENTS_CONTRIBUTING_CODEX_BIN: fake, CODEX_HOME: codexHome, CODEX_THREAD_ID: "" },
  });
  const out = JSON.parse(r.stdout);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(out.provider, "codex");
  assert.equal(out.verdict, "contribute");
  assert.equal(out.used_pct, 40);
  assert.equal(out.stop_at_used_pct, 90);
});

test("parseRollout rejects missing usage instead of reading it as 0", () => {
  const { windows } = parseRollout(line({ ...LIMITS, primary: { ...LIMITS.primary, used_percent: null } }));
  assert.deepEqual(windows.map((w) => w.name), ["seven_day"]);
});

test("inside a Codex session, check-balance reads that session's file instead of launching Codex", () => {
  const home = mkdtempSync(join(tmpdir(), "ac-"));
  const codexHome = join(home, "codex-home");
  const day = join(codexHome, "sessions", "2026", "10", "31");
  mkdirSync(day, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(join(day, "rollout-2026-10-31T00-00-00-own-thread.jsonl"), line({
    ...LIMITS,
    primary: { used_percent: 5, window_minutes: 300, resets_at: now + 7200 },
    secondary: { used_percent: 30, window_minutes: 10080, resets_at: now + 10 * 3600 },
  }));
  writeFileSync(join(home, "contributor.yml"), "provider: codex\n");
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli/check-balance.ts"], {
    encoding: "utf8",
    // A binary that does not exist: the check must not try to launch Codex.
    env: { ...process.env, AGENTS_CONTRIBUTING_HOME: home, AGENTS_CONTRIBUTING_CODEX_BIN: join(home, "missing"), CODEX_HOME: codexHome, CODEX_THREAD_ID: "own-thread" },
  });
  const out = JSON.parse(r.stdout);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(out.used_pct, 30);
  assert.match(out.source, /own-thread\.jsonl$/);
});
