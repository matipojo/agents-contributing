import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { toDate, type Adapter, type Billing, type UsageReading, type UsageWindow } from "../../types.ts";

type RateLimitInfo = {
  status?: string;
  resetsAt?: unknown;
  rateLimitType?: string;
  isUsingOverage?: boolean;
  unifiedWindows?: Record<string, { utilization?: unknown; resetsAt?: unknown }>;
};

/**
 * Reads `claude -p --output-format stream-json --verbose` output. Claude Code emits a
 * rate_limit_event whose rate_limit_info.unifiedWindows holds
 * {five_hour, seven_day}.{utilization (0 to 1), resetsAt (epoch seconds)}, and whose
 * rateLimitType names what the request was charged to. In a cloud session that can be
 * cloud credits ("ccr_promotional", resetsAt is their expiry), and then work does not
 * count against the windows at all.
 */
export function parseProbeOutput(output: string): { windows: UsageWindow[]; billing?: Billing } {
  let info: RateLimitInfo | undefined;
  for (const line of output.split("\n")) {
    if (!line.includes("rate_limit_event")) continue;
    try {
      const event = JSON.parse(line) as { type?: string; rate_limit_info?: RateLimitInfo };
      if (event.type === "rate_limit_event" && event.rate_limit_info) info = event.rate_limit_info; // the last is newest
    } catch {
      // not JSON
    }
  }
  const windows: UsageWindow[] = [];
  for (const [name, w] of Object.entries(info?.unifiedWindows ?? {})) {
    const resetsAt = toDate(w?.resetsAt);
    const used = Number(w?.utilization);
    if (!resetsAt || !Number.isFinite(used)) continue;
    windows.push({ name, usedPct: Math.round(used * 1000) / 10, resetsAt });
  }
  const type = info?.rateLimitType;
  // Window types such as "five_hour" or "seven_day_opus" mean the subscription pays.
  const subscription = !type || /^(five_hour|seven_day)/.test(type);
  const billing = !info || (subscription && !info.isUsingOverage) ? undefined : {
    pool: subscription ? "overage" : type!,
    label: type === "ccr_promotional" ? "Claude cloud session credits" : `Claude "${type}" usage`,
    checkHint: "Check /usage in the Claude app to see how much is left.",
    expiresAt: toDate(info.resetsAt),
    allowed: info.status !== "rejected",
    overage: info.isUsingOverage === true,
  };
  return { windows, billing };
}

/** The command for the probe. Override with AGENTS_CONTRIBUTING_CLAUDE_BIN. */
const CLAUDE_BIN = process.env.AGENTS_CONTRIBUTING_CLAUDE_BIN ?? "claude";

/**
 * Asks Claude Code for the current limits with the smallest possible request: a cheap model,
 * no tools, no MCP servers and no saved session. Works headless, in a scheduled routine.
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
    if (parseProbeOutput(output).windows.length === 0) {
      throw new Error(`Could not run "${CLAUDE_BIN} -p" to read usage: ${err.message.split("\n")[0]}`);
    }
  }
  const { windows, billing } = parseProbeOutput(output);
  if (windows.length === 0) {
    throw new Error("Claude Code reported no usage windows. Usage is only exposed on subscription plans.");
  }
  return { provider: "claude-code", source: `${CLAUDE_BIN} -p`, capturedAt: now, windows, billing };
}

/**
 * What the current Claude Code session has spent, from the last "cost-state" record in its
 * transcript. Claude Code writes that record only now and then, so this can lag behind;
 * pass the live cost with --spent-usd when it is available.
 */
function sessionSpendUsd(sessionId = process.env.CLAUDE_CODE_SESSION_ID): number | null {
  if (!sessionId) return null;
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  if (!existsSync(projects)) return null;
  for (const dir of readdirSync(projects)) {
    const file = join(projects, dir, `${sessionId}.jsonl`);
    if (!existsSync(file)) continue;
    let cost: number | null = null;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.includes('"cost-state"')) continue;
      try {
        const rec = JSON.parse(line) as { type?: string; totalCostUSD?: unknown };
        if (rec.type === "cost-state" && typeof rec.totalCostUSD === "number") cost = rec.totalCostUSD;
      } catch {
        // not JSON
      }
    }
    if (cost !== null) return Math.round(cost * 100) / 100;
  }
  return null;
}

/** Claude Code: runs a tiny headless request and reads the limits Claude Code reports for it. */
export const claudeCode: Adapter = {
  name: "claude-code",
  read(_cfg, now) {
    return probe(now);
  },
  spentUsd: () => sessionSpendUsd(),
};
