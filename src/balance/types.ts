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

/**
 * A provider adapter. `read` reports the usage windows, and `billing` when requests are
 * charged to something else, such as credits. `spentUsd`, if the provider can tell, is what
 * the current run has spent so far; it caps how much of a credit pool one run may use.
 */
export interface Adapter {
  name: string;
  read(cfg: ContributorConfig, now: Date): UsageReading;
  spentUsd?(): number | null;
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
