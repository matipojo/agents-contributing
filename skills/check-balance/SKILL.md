---
name: agents-contributing-check-balance
description: Check how much unused AI subscription capacity is left before the usage window resets, and decide whether to donate it now. Use before any agents-contributing work, or when asked how much usage or how many tokens are left.
---

# Check the balance

Decides whether there is unused subscription capacity to donate right now, and how much.
Run it before starting any contribution, and again after each task.

## Run

```bash
bash skills/check-balance/check.sh
```

The script installs the tools on first use (into `~/.agents-contributing/tools`) and needs no
config and no input. Exit codes: `0` contribute, `10` skip, `2` unknown or error. Output is JSON.
`--spent-usd N` tells it what this run has spent, for the daily cap on credits. Without it,
the provider's own estimate is used, if it has one.

To change the defaults, write `~/.agents-contributing/contributor.yml` from
`templates/contributor.yml`. Set `AGENTS_CONTRIBUTING_HOME` to use another directory.

## Run it on a schedule

Contributions run unattended, in a scheduled routine. Schedule it **daily**: with `lead_hours: 24`
a daily run always lands once inside the day before the weekly reset, whatever day that is, and
every other run skips at almost no cost. The user is not asked anything.

Create the routine with notifications on, so a `notify` message reaches the owner. How to
create one, and how a run reads what it spent, differs per agent: see the provider's README.

Routine prompt:

> Run the balance check:
> `[ -d ~/.agents-contributing/tools ] || git clone --depth 1 https://github.com/matipojo/agents-contributing ~/.agents-contributing/tools; bash ~/.agents-contributing/tools/skills/check-balance/check.sh --spent-usd <cost>`,
> where `<cost>` is what this run has spent so far, read as the provider's README says
> (leave the flag out if you cannot read it).
> If the result has `notify`, end the run with exactly that message.
> If the verdict is `skip` or `unknown`, stop. Otherwise do one agents-contributing task, run the
> check again, and repeat while the verdict allows it. Stop when usage reaches
> `stop_at_used_pct` or the session cost reaches `max_spend_usd`.

## Providers

Set `provider` in `contributor.yml`. Each one has its own folder under `src/balance/adapters/`,
with a README on how it reads usage and what a routine needs:

- [`claude-code`](../../src/balance/adapters/claude-code/README.md) (default): real usage
  windows and cloud credits, with no setup.
- [`codex`](../../src/balance/adapters/codex/README.md): real usage windows from a
  tiny `codex exec` turn. Bought credits are never donated.
- [`declared`](../../src/balance/adapters/declared/README.md): for agents that do not expose
  usage. Only the reset time is known.

## Read the result

| verdict | What to do |
|---|---|
| `contribute` | Contribute. Stop when usage reaches `stop_at_used_pct`. Re-check after each task. |
| `contribute-until-limited` | Usage is not exposed. Contribute, and stop at the first limit message from the provider, or once the run has spent `max_spend_usd` when it is set. Never retry around a limit. |
| `skip` | Do nothing. `reason` says why, for example the reset is too far away or the surplus is too small. |
| any, with `notify` | Pass the message on to the owner as the run's final message. |
| `unknown` | Do nothing and end the run. `reason` says what is wrong; the next run tries again. |

## How the decision is made

- Only within `lead_hours` before the window resets. Before that, the user may still need it.
- Always keep `margin_pct` of the window unused.
- Give `donate_fraction` of what remains after the margin.
- If any shorter window (such as five hours) is nearly full, wait for it to reset.
- Skip when the donation is below `min_surplus_pct`.
- `donate` says what may be given: `subscription`, `credits`, or both (the default).
- If the run is charged to credits (for example Claude cloud session credits), the windows do
  not apply. How much is left is usually not exposed, so credits are donated only in the last
  `credits.lead_days` (3) days before they expire, at most `credits.daily_usd` ($15) per daily run.
  When they run out, the next check falls back to the subscription windows.
- `credits.remind_days` (7) before the credits expire, one run returns `notify`: a reminder to
  check the balance and use them, since the routine cannot spend a large amount in the last days.
- Never contribute when the run is charged to paid extra usage.

## Rules

- The user's own work always comes first. When unsure, skip.
- Never report token counts or plan details anywhere public.
