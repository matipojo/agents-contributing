#!/usr/bin/env -S npx tsx
/**
 * Claude Code statusLine command that records usage limits for agents-contributing.
 *
 * Claude Code pipes a JSON object to the statusLine command on stdin. On subscription
 * plans it can include rate_limits.five_hour and rate_limits.seven_day with
 * used_percentage and resets_at. This saves them to a cache that check-balance reads,
 * then prints a short status line.
 *
 * To keep an existing statusLine command, set AGENTS_CONTRIBUTING_NEXT_STATUSLINE to it.
 * The same input is passed through and its output is printed instead.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { HOME } from "../balance/config.ts";
import { CLAUDE_CACHE } from "../balance/adapters.ts";

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const input = Buffer.concat(chunks).toString("utf8");

let data: { rate_limits?: Record<string, { used_percentage?: number }>; model?: { id?: string } } = {};
try {
  data = JSON.parse(input);
} catch {
  // not JSON: nothing to record
}

const rl = data.rate_limits;
if (rl && typeof rl === "object" && Object.keys(rl).length > 0) {
  mkdirSync(HOME, { recursive: true });
  const tmp = `${CLAUDE_CACHE}.tmp`;
  writeFileSync(tmp, JSON.stringify({
    captured_at: Math.floor(Date.now() / 1000),
    model: data.model?.id,
    rate_limits: rl,
  }));
  renameSync(tmp, CLAUDE_CACHE);
}

const next = process.env.AGENTS_CONTRIBUTING_NEXT_STATUSLINE;
if (next) {
  process.stdout.write(execSync(next, { input, encoding: "utf8" }));
} else {
  const parts: string[] = [];
  for (const [key, label] of [["five_hour", "5h"], ["seven_day", "7d"]] as const) {
    const used = rl?.[key]?.used_percentage;
    if (typeof used === "number") parts.push(`${label} ${Math.round(used)}%`);
  }
  console.log(parts.length ? parts.join(" | ") : "usage: n/a");
}
