import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ContributorConfig {
  version: number;
  provider: string;
  targets: { repos: string[]; topics: string[] };
  help_types: string[];
  budget: {
    window: string;
    lead_hours: number;
    margin_pct: number;
    donate_fraction: number;
    min_surplus_pct: number;
  };
  declared: { timezone: string; weekly_reset: string };
  log: boolean;
}

export const HOME = process.env.AGENTS_CONTRIBUTING_HOME ?? join(homedir(), ".agents-contributing");
export const DEFAULT_CONFIG_PATH = join(HOME, "contributor.yml");

const DEFAULTS: ContributorConfig = {
  version: 1,
  provider: "claude-code",
  targets: { repos: [], topics: ["agents-contributing"] },
  help_types: ["reproduce", "triage", "tests", "docs"],
  budget: { window: "seven_day", lead_hours: 24, margin_pct: 10, donate_fraction: 1, min_surplus_pct: 5 },
  declared: { timezone: "UTC", weekly_reset: "sun 00:00" },
  log: true,
};

/** A missing config at the default path means "use the defaults", so a routine needs no setup. */
export function loadConfig(path = DEFAULT_CONFIG_PATH): ContributorConfig {
  const missingDefault = path === DEFAULT_CONFIG_PATH && !existsSync(path);
  const raw = (missingDefault ? {} : parseYaml(readFileSync(path, "utf8")) ?? {}) as Partial<ContributorConfig>;
  const cfg: ContributorConfig = {
    ...DEFAULTS,
    ...raw,
    targets: { ...DEFAULTS.targets, ...raw.targets },
    budget: { ...DEFAULTS.budget, ...raw.budget },
    declared: { ...DEFAULTS.declared, ...raw.declared },
  };
  const b = cfg.budget;
  if (b.donate_fraction < 0 || b.donate_fraction > 1) throw new Error("budget.donate_fraction must be between 0 and 1");
  if (b.margin_pct < 0 || b.margin_pct > 100) throw new Error("budget.margin_pct must be between 0 and 100");
  return cfg;
}
