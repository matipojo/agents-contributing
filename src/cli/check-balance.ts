#!/usr/bin/env -S npx tsx
/**
 * Decide whether there is unused subscription capacity to donate right now.
 *
 * Usage: npx tsx src/cli/check-balance.ts [path/to/contributor.yml]
 * Prints a JSON decision. Exit codes: 0 contribute, 10 skip, 2 unknown or error.
 */
import { loadConfig, DEFAULT_CONFIG_PATH } from "../balance/config.ts";
import { ADAPTERS } from "../balance/adapters.ts";
import { decide } from "../balance/decide.ts";

const STALE_MINUTES = 30;
const path = process.argv[2] ?? DEFAULT_CONFIG_PATH;
const now = new Date();

try {
  const cfg = loadConfig(path);
  const adapter = ADAPTERS[cfg.provider];
  if (!adapter) {
    throw new Error(`Unknown provider "${cfg.provider}". Known: ${Object.keys(ADAPTERS).join(", ")}.`);
  }
  const reading = adapter.read(cfg, now);
  const decision = decide(cfg, reading, now);
  // Usage only grows inside a window, so an old reading overstates the surplus.
  const ageMinutes = Math.round((now.getTime() - reading.capturedAt.getTime()) / 60000);
  const stale = ageMinutes > STALE_MINUTES;
  console.log(JSON.stringify({
    provider: reading.provider,
    source: reading.source,
    captured_at: reading.capturedAt.toISOString(),
    age_minutes: ageMinutes,
    stale,
    ...decision,
    ...(stale && decision.verdict === "contribute"
      ? { reason: `${decision.reason} The reading is ${ageMinutes} minutes old, so re-check after every task.` }
      : {}),
  }, null, 2));
  process.exit(decision.verdict === "skip" ? 10 : decision.verdict === "unknown" ? 2 : 0);
} catch (e) {
  console.log(JSON.stringify({ verdict: "unknown", reason: (e as Error).message }, null, 2));
  process.exit(2);
}
