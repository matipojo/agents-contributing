import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { detectAdapter } from "./adapters/index.ts";

export interface ContributorConfig {
  version: number;
  provider: string;
  /**
   * `repos` are the repositories the contributor approved: the only ones contributed to.
   * `topics` find more, which are reported and wait for approval, unless `auto_approve`.
   */
  targets: { repos: string[]; topics: string[]; auto_approve?: boolean };
  help_types: string[];
  budget: {
    window: string;         // "" means the provider's own (seven_day for most, monthly for Cursor)
    lead_hours: number;
    margin_pct: number;
    donate_fraction: number;
    min_surplus_pct: number;
  };
  /** What may be donated: "subscription" (the usage windows) and/or "credits" (a credit pool, such as Claude cloud session credits). */
  donate: string[];
  credits: {
    lead_days: number;      // start donating credits this many days before they expire
    daily_usd: number;      // spend at most this much of the credits per daily run
    remind_days: number;    // remind the owner once, this many days before they expire
  };
  declared: { timezone: string; weekly_reset: string };
  log: boolean;
  /** The contributor's runner repository. Default: <login>/agents-contributing-runner. */
  runner_repo?: string;
}

export const HOME = process.env.AGENTS_CONTRIBUTING_HOME ?? join(homedir(), ".agents-contributing");
export const DEFAULT_CONFIG_PATH = join(HOME, "contributor.yml");

/** Where the runner itself comes from. */
export const HOME_REPO = "matipojo/agents-contributing";
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

/** True for `owner/name`, as GitHub writes it. */
export const isRepoName = (name: unknown): name is string => typeof name === "string" && REPO_NAME.test(name);

/**
 * Repositories approved in the environment: AGENTS_CONTRIBUTING_REPOS, separated by commas or
 * spaces. For a cloud routine, where no config file survives between runs.
 */
export function approvedInEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.AGENTS_CONTRIBUTING_REPOS ?? "").split(/[\s,]+/).filter(Boolean);
}

const DEFAULTS: ContributorConfig = {
  version: 1,
  provider: "declared",
  // The project's own repository is approved from the start: the contributor already runs its
  // code, as the runner. Everything else found by topic waits for them.
  targets: { repos: [HOME_REPO], topics: ["agents-contributing"], auto_approve: false },
  help_types: ["audit", "pr", "review", "reproduce", "triage", "tests", "docs"],
  budget: { window: "", lead_hours: 24, margin_pct: 10, donate_fraction: 1, min_surplus_pct: 5 },
  donate: ["subscription", "credits"],
  credits: { lead_days: 3, daily_usd: 15, remind_days: 7 },
  declared: { timezone: "UTC", weekly_reset: "sun 00:00" },
  log: true,
};

/**
 * The agent the runner is called from, when the config does not say. Each adapter knows how
 * to recognize its own agent; an agent without an adapter gets the fallback, which works with
 * no usage reading at all.
 */
export function detectProvider(env: NodeJS.ProcessEnv = process.env): string {
  return detectAdapter(env).name;
}

/** A missing config at the default path means "use the defaults", so a routine needs no setup. */
export function loadConfig(path = DEFAULT_CONFIG_PATH): ContributorConfig {
  const missingDefault = path === DEFAULT_CONFIG_PATH && !existsSync(path);
  const raw = (missingDefault ? {} : parseYaml(readFileSync(path, "utf8")) ?? {}) as Partial<ContributorConfig>;
  const cfg: ContributorConfig = {
    ...DEFAULTS,
    provider: detectProvider(),
    ...raw,
    targets: { ...DEFAULTS.targets, ...raw.targets },
    budget: { ...DEFAULTS.budget, ...raw.budget },
    credits: { ...DEFAULTS.credits, ...raw.credits },
    declared: { ...DEFAULTS.declared, ...raw.declared },
  };
  const t = cfg.targets;
  if (!Array.isArray(t.repos) || !Array.isArray(t.topics)) throw new Error("targets.repos and targets.topics must be lists");
  if (t.auto_approve !== undefined && typeof t.auto_approve !== "boolean") throw new Error("targets.auto_approve must be true or false");
  t.repos = [...new Set([...t.repos, ...approvedInEnv()])];
  for (const name of t.repos) {
    if (!isRepoName(name)) throw new Error(`targets.repos: "${name}" is not a repository name (owner/name)`);
  }
  for (const d of cfg.donate) {
    if (d !== "subscription" && d !== "credits") throw new Error(`donate may only list subscription and credits, got "${d}"`);
  }
  const b = cfg.budget;
  // YAML accepts .nan, .inf and strings here, which would silently disable the safeguards.
  const numbers: [string, unknown][] = [
    ...Object.entries(b).filter(([k]) => k !== "window").map(([k, v]): [string, unknown] => [`budget.${k}`, v]),
    ...Object.entries(cfg.credits).map(([k, v]): [string, unknown] => [`credits.${k}`, v]),
  ];
  for (const [key, v] of numbers) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`${key} must be a number of 0 or more`);
  }
  if (b.donate_fraction < 0 || b.donate_fraction > 1) throw new Error("budget.donate_fraction must be between 0 and 1");
  if (b.margin_pct < 0 || b.margin_pct > 100) throw new Error("budget.margin_pct must be between 0 and 100");
  return cfg;
}
