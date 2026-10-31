import type { ContributorConfig } from "./config.ts";


/** One usage window as reported by a provider. */
export interface UsageWindow {
  name: string;
  usedPct: number | null;   // null when the provider does not expose usage
  resetsAt: Date;
}

/** What the current request is charged to, when that is not the subscription windows. */
export interface Billing {
  pool: string;             // the provider's name for it, e.g. "ccr_promotional"
  label: string;            // for people, e.g. "Claude cloud session credits"
  checkHint?: string;       // where the owner can see how much is left
  expiresAt: Date | null;   // when the pool expires or resets
  allowed: boolean;         // false when the provider refuses requests from this pool
  overage: boolean;         // true when paid extra usage is being spent
}

export interface UsageReading {
  provider: string;
  source: string;           // where the numbers came from
  capturedAt: Date;
  windows: UsageWindow[];
  billing?: Billing;        // absent when requests count against the windows
}

/** One run of the agent, in a checkout of the target repository. */
export interface AgentTask {
  cwd: string;
  prompt: string;
  write: boolean;           // false: read-only; true: may edit files and run commands in cwd
}

export interface AgentResult {
  text: string;             // the agent's final message
  model: string;            // the model that did the work, for the contribution marker
}

/** How an adapter launches its agent, for schedulers that only run commands. */
export interface Agent {
  run(task: AgentTask): AgentResult;
}

/** What GitHub Actions needs to run this agent in the runner repository's workflow. */
export interface CiSupport {
  install: string;          // shell command that installs the agent's CLI
  secret?: {
    name: string;           // the repository secret the agent reads, e.g. CLAUDE_CODE_OAUTH_TOKEN
    command?: string;       // what the user runs once to create it, e.g. "claude setup-token"
    help: string;           // one line telling the user what to copy
  };
}

/**
 * A provider adapter: everything the project knows about one agent, in one folder.
 * Nothing outside src/balance/adapters/ names a provider; see the README there.
 */
export interface Adapter {
  /** The folder name, and the `provider` value in contributor.yml. */
  name: string;
  /** The company behind it, for the contribution marker's `provider` field. */
  vendor: string;
  /** True when the runner is called from inside this agent, from the environment it sets. */
  detect?(env: NodeJS.ProcessEnv): boolean;
  /** The usage windows, and `billing` when requests are charged to something else. */
  read(cfg: ContributorConfig, now: Date): UsageReading;
  /** What the current run has spent so far, if the provider can tell. Caps credit pools. */
  spentUsd?(): number | null;
  /** How to launch the agent, for GitHub Actions and cron. Routines do not need it. */
  agent?: Agent;
  /** How to install and sign in the agent in GitHub Actions, when that works. */
  ci?: CiSupport;
}

/** Accepts epoch seconds, epoch milliseconds or an ISO string. */
export function toDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return toDate(n);
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
