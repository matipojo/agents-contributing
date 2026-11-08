import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authFile, cursorToken, parsePeriodUsage, cursor } from "./adapter.ts";

// The shape of a real GetCurrentPeriodUsage answer (Pro plan), trimmed to what is read.
const SAMPLE = {
  billingCycleStart: "1791570720000",
  billingCycleEnd: "1794249120000",
  planUsage: { totalSpend: 4272, includedSpend: 2000, bonusSpend: 2272, limit: 2000, autoPercentUsed: 6.466666666666667, apiPercentUsed: 60.53333333333333, totalPercentUsed: 9.041269841269841 },
  displayMessage: "You've used 50% of your included usage",
  autoModelSelectedDisplayMessage: "You've used 9% of your included total usage",
  namedModelSelectedDisplayMessage: "You've used 61% of your included API usage",
};

test("parsePeriodUsage reads the total and the API figure, with the cycle end as the reset", () => {
  const w = parsePeriodUsage(SAMPLE);
  assert.deepEqual(w.map((x) => [x.name, x.usedPct, x.resetsAt.toISOString()]), [
    ["monthly", 9, "2026-11-09T18:32:00.000Z"],
    ["monthly_api", 60.5, "2026-11-09T18:32:00.000Z"],
  ]);
});

test("parsePeriodUsage drops missing or invalid figures instead of reading them as 0%", () => {
  const bad = { ...SAMPLE, planUsage: { totalPercentUsed: null, apiPercentUsed: "61" } };
  assert.deepEqual(parsePeriodUsage(bad), []);
  assert.deepEqual(parsePeriodUsage({ ...SAMPLE, planUsage: { totalPercentUsed: -1, apiPercentUsed: 12 } }).map((x) => x.name), ["monthly_api"]);
  assert.deepEqual(parsePeriodUsage({ planUsage: SAMPLE.planUsage }), [], "no cycle end, no reset");
  assert.deepEqual(parsePeriodUsage(null), []);
});

test("usage above 100% is kept, so the surplus is zero", () => {
  assert.equal(parsePeriodUsage({ ...SAMPLE, planUsage: { totalPercentUsed: 130 } })[0]?.usedPct, 130);
});

test("the login is found where the Cursor CLI keeps it, per platform", () => {
  assert.equal(authFile({ XDG_CONFIG_HOME: "/x" }, "linux"), "/x/cursor/auth.json");
  assert.match(authFile({}, "linux"), /\.config\/cursor\/auth\.json$/);
  assert.match(authFile({}, "darwin"), /\.cursor\/auth\.json$/);
  assert.match(authFile({ APPDATA: "/a" }, "win32"), /Cursor\/auth\.json$/);
});

test("the token comes from CURSOR_AUTH_TOKEN first, then from the saved login", () => {
  const dir = mkdtempSync(join(tmpdir(), "ac-cursor-"));
  mkdirSync(join(dir, "cursor"));
  writeFileSync(join(dir, "cursor", "auth.json"), JSON.stringify({ accessToken: "saved", refreshToken: "r" }));
  assert.equal(cursorToken({ XDG_CONFIG_HOME: dir }, "linux"), "saved");
  assert.equal(cursorToken({ XDG_CONFIG_HOME: dir, CURSOR_AUTH_TOKEN: " env " }, "linux"), "env");
  assert.equal(cursorToken({ XDG_CONFIG_HOME: join(dir, "none") }, "linux"), null);
  writeFileSync(join(dir, "cursor", "auth.json"), "not json");
  assert.equal(cursorToken({ XDG_CONFIG_HOME: dir }, "linux"), null);
});

test("detects the Cursor agent from the variable it sets for its commands", () => {
  assert.equal(cursor.detect?.({ CURSOR_AGENT: "1" }), true);
  assert.equal(cursor.detect?.({ CURSOR_AGENT: "" }), false);
  assert.equal(cursor.detect?.({ CURSOR_API_KEY: "x" }), false, "a key alone does not mean the runner is called from Cursor");
});

test("check-balance reads Cursor's usage over the network, and decides on the monthly window", async () => {
  const seen: { path?: string; auth?: string; connect?: string; body?: string; method?: string } = {};
  const resetIn = 10 * 3_600_000;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      Object.assign(seen, { path: req.url, auth: req.headers.authorization, connect: String(req.headers["connect-protocol-version"]), body, method: req.method });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ...SAMPLE, billingCycleEnd: String(Date.now() + resetIn) }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  const home = mkdtempSync(join(tmpdir(), "ac-"));
  writeFileSync(join(home, "contributor.yml"), "provider: cursor\n");
  const env = { ...process.env, AGENTS_CONTRIBUTING_HOME: home, AGENTS_CONTRIBUTING_CURSOR_API: `http://127.0.0.1:${port}`, CURSOR_AUTH_TOKEN: "test-token" } as NodeJS.ProcessEnv;
  delete env.NODE_USE_ENV_PROXY;
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli/check-balance.ts"], { env });
  let stdout = "";
  child.stdout.on("data", (c) => (stdout += c));
  const code: number = await new Promise((ok) => child.on("close", ok));
  server.close();
  const out = JSON.parse(stdout);
  assert.equal(code, 0, stdout);
  assert.deepEqual(seen, { path: "/aiserver.v1.DashboardService/GetCurrentPeriodUsage", auth: "Bearer test-token", connect: "1", body: "{}", method: "POST" });
  assert.equal(out.provider, "cursor");
  assert.equal(out.window, "monthly");
  assert.equal(out.used_pct, 9);
  assert.equal(out.verdict, "contribute");
  assert.equal(out.donate_pct, 81);
  assert.equal(out.stop_at_used_pct, 90);
});

test("check-balance without a login says what to do", async () => {
  const home = mkdtempSync(join(tmpdir(), "ac-"));
  writeFileSync(join(home, "contributor.yml"), "provider: cursor\n");
  const env = { ...process.env, AGENTS_CONTRIBUTING_HOME: home, XDG_CONFIG_HOME: join(home, "none"), HOME: home } as NodeJS.ProcessEnv;
  delete env.CURSOR_AUTH_TOKEN;
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli/check-balance.ts"], { env });
  let stdout = "";
  child.stdout.on("data", (c) => (stdout += c));
  const code: number = await new Promise((ok) => child.on("close", ok));
  assert.equal(code, 2);
  assert.match(JSON.parse(stdout).reason, /agent login/);
});
