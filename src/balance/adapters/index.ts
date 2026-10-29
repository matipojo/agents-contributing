import type { Adapter } from "../types.ts";
import { claudeCode } from "./claude-code/adapter.ts";
import { declared } from "./declared/adapter.ts";

/** Every provider adapter, by the name used in contributor.yml. Add new ones here. */
export const ADAPTERS: Record<string, Adapter> = {
  [claudeCode.name]: claudeCode,
  [declared.name]: declared,
};
