import type { Adapter } from "../types.ts";
import { claudeCode } from "./claude-code/adapter.ts";
import { codex } from "./codex/adapter.ts";
import { declared } from "./declared/adapter.ts";

/**
 * Every provider adapter, by the name used in contributor.yml. Adding a provider is one folder
 * and one line here; test/adapters.test.ts fails until both exist and match.
 */
export const ADAPTERS: Record<string, Adapter> = {
  [claudeCode.name]: claudeCode,
  [codex.name]: codex,
  [declared.name]: declared,
};

/** Used for any agent that no adapter detects: it works with no usage reading at all. */
export const FALLBACK = declared;

/** The adapter of the agent the runner is called from, or the fallback. */
export function detectAdapter(env: NodeJS.ProcessEnv = process.env): Adapter {
  return Object.values(ADAPTERS).find((a) => a.detect?.(env)) ?? FALLBACK;
}
