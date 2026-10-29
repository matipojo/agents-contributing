#!/usr/bin/env -S npx tsx
/**
 * Decide whether there is unused subscription capacity to donate right now.
 *
 * Usage: npx tsx src/cli/check-balance.ts [--spent-usd N] [path/to/contributor.yml]
 * --spent-usd is what this run has spent so far, for the daily cap on credits.
 * Without it, the adapter's own estimate is used, if it has one.
 * Prints a JSON decision. Exit codes: 0 contribute, 10 skip, 2 unknown or error.
 */
import { loadConfig, DEFAULT_CONFIG_PATH } from "../balance/config.ts";
import { ADAPTERS } from "../balance/adapters/index.ts";
import { decide } from "../balance/decide.ts";

const args = process.argv.slice(2);
const spentAt = args.indexOf("--spent-usd");
const spentArg = spentAt >= 0 ? Number(args.splice(spentAt, 2)[1]) : NaN;
const path = args[0] ?? DEFAULT_CONFIG_PATH;
const now = new Date();

try {
  const cfg = loadConfig(path);
  const adapter = ADAPTERS[cfg.provider];
  if (!adapter) {
    throw new Error(`Unknown provider "${cfg.provider}". Known: ${Object.keys(ADAPTERS).join(", ")}.`);
  }
  const reading = adapter.read(cfg, now);
  if (spentAt >= 0 && !(spentArg >= 0)) throw new Error("--spent-usd must be a number of 0 or more.");
  const spent = spentAt >= 0 ? spentArg : adapter.spentUsd?.() ?? null;
  const decision = decide(cfg, reading, now, spent);
  console.log(JSON.stringify({
    provider: reading.provider,
    source: reading.source,
    captured_at: reading.capturedAt.toISOString(),
    ...decision,
  }, null, 2));
  process.exit(decision.verdict === "skip" ? 10 : decision.verdict === "unknown" ? 2 : 0);
} catch (e) {
  console.log(JSON.stringify({ verdict: "unknown", reason: (e as Error).message }, null, 2));
  process.exit(2);
}
