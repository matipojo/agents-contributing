import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { toDate, type Adapter, type UsageReading, type UsageWindow } from "../../types.ts";

const API = process.env.AGENTS_CONTRIBUTING_CURSOR_API ?? "https://api2.cursor.sh";
const RPC = "/aiserver.v1.DashboardService/GetCurrentPeriodUsage";

/** The login `agent login` saved, at the path the Cursor CLI itself uses on each platform. */
export function authFile(env: NodeJS.ProcessEnv = process.env, os: string = platform()): string {
  if (os === "win32") return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "Cursor", "auth.json");
  if (os === "darwin") return join(homedir(), ".cursor", "auth.json");
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "cursor", "auth.json");
}

/**
 * The access token to read usage with: CURSOR_AUTH_TOKEN when set (the Cursor CLI reads the
 * same variable), otherwise the token `agent login` saved. API keys are not used: they were
 * not tested against this endpoint.
 */
export function cursorToken(env: NodeJS.ProcessEnv = process.env, os: string = platform()): string | null {
  const own = env.CURSOR_AUTH_TOKEN?.trim();
  if (own) return own;
  const file = authFile(env, os);
  if (!existsSync(file)) return null;
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as { accessToken?: unknown };
    return typeof saved.accessToken === "string" && saved.accessToken ? saved.accessToken : null;
  } catch {
    return null;
  }
}

/**
 * Reads the answer of aiserver.v1.DashboardService/GetCurrentPeriodUsage:
 * billingCycleEnd (epoch milliseconds, as a string) and planUsage.{totalPercentUsed,
 * apiPercentUsed} (0 and up, percent of the included usage). Cursor shows the total when Auto
 * is selected and the API figure when a named model is, so both are windows; they share the
 * monthly reset. Anything missing or out of range is dropped, never read as 0%.
 */
export function parsePeriodUsage(payload: unknown): UsageWindow[] {
  const data = payload as { billingCycleEnd?: unknown; planUsage?: { totalPercentUsed?: unknown; apiPercentUsed?: unknown } } | null;
  const resetsAt = toDate(data?.billingCycleEnd);
  if (!resetsAt) return [];
  const windows: UsageWindow[] = [];
  for (const [name, used] of [["monthly", data?.planUsage?.totalPercentUsed], ["monthly_api", data?.planUsage?.apiPercentUsed]] as const) {
    if (typeof used !== "number" || !Number.isFinite(used) || used < 0) continue;
    windows.push({ name, usedPct: Math.round(used * 10) / 10, resetsAt });
  }
  return windows;
}

/** Reads the plan's usage from Cursor. No agent turn is run, so checking costs nothing. */
async function read(_cfg: unknown, now: Date): Promise<UsageReading> {
  const token = cursorToken();
  if (!token) throw new Error("Not logged in to Cursor. Run `agent login` once (or set CURSOR_AUTH_TOKEN).");
  const res = await fetch(`${API}${RPC}`, {
    method: "POST",
    headers: { "content-type": "application/json", "connect-protocol-version": "1", authorization: `Bearer ${token}` },
    body: "{}",
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error("Cursor rejected the login, which may have expired. Run `agent login` again.");
  if (!res.ok) throw new Error(`Cursor usage request failed: ${res.status}`);
  const windows = parsePeriodUsage(await res.json());
  if (windows.length === 0) throw new Error("Cursor reported no usage for this period.");
  return { provider: "cursor", source: `${API}${RPC}`, capturedAt: now, windows, primaryWindow: "monthly" };
}

/**
 * Cursor: usage comes from the plan's current period, which is monthly. Launching Cursor from
 * GitHub Actions or cron is not supported (see the README); a Cursor automation calls the runner.
 */
export const cursor: Adapter = {
  name: "cursor",
  vendor: "cursor",
  // Cursor sets CURSOR_AGENT=1 for every shell command its agent runs.
  detect: (env) => env.CURSOR_AGENT === "1",
  // Seen in `ps` as /root/.local/bin/cursor-agent, for the agent that runs the commands.
  processNames: ["cursor-agent"],
  read,
};
