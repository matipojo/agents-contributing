import type { ContributorConfig } from "./config.ts";
import type { UsageReading } from "./adapters.ts";

export type Verdict = "contribute" | "contribute-until-limited" | "skip" | "unknown";

export interface Decision {
  verdict: Verdict;
  reason: string;
  window: string;
  hours_to_reset: number;
  used_pct: number | null;
  surplus_pct: number | null;   // what is left after the margin
  donate_pct: number | null;    // the share of the window to spend on contributions
  stop_at_used_pct: number | null; // stop contributing once usage reaches this
  resets_at: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function decide(cfg: ContributorConfig, reading: UsageReading, now: Date): Decision {
  const b = cfg.budget;
  const win = reading.windows.find((w) => w.name === b.window);
  if (!win) {
    return {
      verdict: "unknown",
      reason: `The provider reported no "${b.window}" window. Available: ${reading.windows.map((w) => w.name).join(", ")}.`,
      window: b.window, hours_to_reset: NaN, used_pct: null, surplus_pct: null,
      donate_pct: null, stop_at_used_pct: null, resets_at: "",
    };
  }
  const hoursToReset = round1((win.resetsAt.getTime() - now.getTime()) / 3_600_000);
  const base = {
    window: win.name, hours_to_reset: hoursToReset, used_pct: win.usedPct, resets_at: win.resetsAt.toISOString(),
  };

  if (hoursToReset > b.lead_hours) {
    return {
      ...base, verdict: "skip", surplus_pct: null, donate_pct: null, stop_at_used_pct: null,
      reason: `The window resets in ${hoursToReset}h, more than lead_hours (${b.lead_hours}h). The owner may still need it.`,
    };
  }

  // A short window that is nearly full blocks work right now, whatever the long window says.
  for (const other of reading.windows) {
    if (other !== win && other.usedPct !== null && other.usedPct >= 100 - b.margin_pct) {
      return {
        ...base, verdict: "skip", surplus_pct: null, donate_pct: null, stop_at_used_pct: null,
        reason: `The "${other.name}" window is at ${other.usedPct}%. Try again after it resets at ${other.resetsAt.toISOString()}.`,
      };
    }
  }

  if (win.usedPct === null) {
    return {
      ...base, verdict: "contribute-until-limited", surplus_pct: null, donate_pct: null, stop_at_used_pct: null,
      reason: `Usage is not exposed. Inside the lead window, so contribute and stop at the first limit message from the provider.`,
    };
  }

  const surplus = Math.max(0, 100 - b.margin_pct - win.usedPct);
  const donate = round1(surplus * b.donate_fraction);
  if (donate < b.min_surplus_pct) {
    return {
      ...base, verdict: "skip", surplus_pct: round1(surplus), donate_pct: donate, stop_at_used_pct: null,
      reason: `Only ${donate}% to donate, below min_surplus_pct (${b.min_surplus_pct}%).`,
    };
  }
  return {
    ...base, verdict: "contribute", surplus_pct: round1(surplus), donate_pct: donate,
    stop_at_used_pct: round1(win.usedPct + donate),
    reason: `${donate}% of the "${win.name}" window is free to donate before it resets in ${hoursToReset}h.`,
  };
}
