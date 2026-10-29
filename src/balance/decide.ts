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
  max_spend_usd?: number;       // credits: stop once this run has spent this much
  spent_usd?: number | null;    // credits: what this run has spent so far
  notify?: string;              // a message for the owner; the routine passes it on
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** `spentUsd` is what this run has spent so far, used for the daily credits cap. */
export function decide(cfg: ContributorConfig, reading: UsageReading, now: Date, spentUsd: number | null = null): Decision {
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
  const billing = reading.billing;
  if (billing) return decideBilling(cfg, billing, now, spentUsd);
  const base = {
    window: win.name, hours_to_reset: hoursToReset, used_pct: win.usedPct, resets_at: win.resetsAt.toISOString(),
  };
  if (!cfg.donate.includes("subscription")) {
    return {
      ...base, verdict: "skip", surplus_pct: null, donate_pct: null, stop_at_used_pct: null,
      reason: `The subscription is not in donate (${cfg.donate.join(", ") || "nothing"}).`,
    };
  }

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

/**
 * The request is charged to something other than the subscription windows, for example
 * cloud credits. Contributing would spend that, and never move the window percentages.
 * The remaining amount is not exposed, so credits are donated only in the last
 * credits.lead_days before they expire, at most credits.daily_usd per daily run.
 */
function decideBilling(
  cfg: ContributorConfig, billing: NonNullable<UsageReading["billing"]>, now: Date, spentUsd: number | null,
): Decision {
  const c = cfg.credits;
  const expires = billing.expiresAt;
  const hours = expires ? round1((expires.getTime() - now.getTime()) / 3_600_000) : NaN;
  const base = {
    window: billing.pool, hours_to_reset: hours, used_pct: null, surplus_pct: null,
    donate_pct: null, stop_at_used_pct: null, resets_at: expires?.toISOString() ?? "",
  };
  const skip = (reason: string, notify?: string): Decision => ({ ...base, verdict: "skip", reason, ...(notify ? { notify } : {}) });

  if (billing.overage) return skip("Requests are charged to paid extra usage. Never donate money.");
  if (!billing.allowed) return skip(`The "${billing.pool}" pool is refusing requests.`);
  const what = `Requests are charged to "${billing.pool}" (cloud credits), not the subscription windows.`;
  if (!expires) return skip(`${what} Their expiry is unknown.`);

  const days = hours / 24;
  const donating = cfg.donate.includes("credits");
  // A daily run lands exactly once in this 24-hour band, so the reminder goes out once.
  const remind = days <= c.remind_days && days > c.remind_days - 1
    ? `Your Claude cloud session credits expire on ${expires.toISOString().slice(0, 10)}. Check /usage to see how much is left. ` +
      (donating
        ? `Whatever you do not use, up to $${c.daily_usd} a day, will be donated to open source in the last ${c.lead_days} days.`
        : "Credits are not set to be donated, so anything unused will be lost.")
    : undefined;

  if (!donating) return skip(`${what} Credits are not in donate (${cfg.donate.join(", ") || "nothing"}).`, remind);
  if (days > c.lead_days) {
    return skip(`${what} They expire in ${hours}h, more than credits.lead_days (${c.lead_days} days). The owner may still need them.`, remind);
  }
  if (spentUsd !== null && spentUsd >= c.daily_usd) {
    return { ...skip(`This run spent $${spentUsd}, the daily cap is credits.daily_usd ($${c.daily_usd}).`), spent_usd: spentUsd };
  }
  return {
    ...base, verdict: "contribute-until-limited", max_spend_usd: c.daily_usd, spent_usd: spentUsd,
    ...(remind ? { notify: remind } : {}),
    reason: `${what} They expire in ${hours}h. Contribute up to $${c.daily_usd} in this run and re-check after each task. ` +
      "Once they run out, the check moves on to the subscription windows.",
  };
}
