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
`--spent-usd N` tells it what this run has spent, for the daily cap on cloud credits. Without
it, the last cost in this session's transcript is used, which can lag behind.

To change the defaults, write `~/.agents-contributing/contributor.yml` from
`templates/contributor.yml`. Set `AGENTS_CONTRIBUTING_HOME` to use another directory.

## Run it on a schedule

Contributions run unattended, in a scheduled routine. Schedule it **daily**: with `lead_hours: 24`
a daily run always lands once inside the day before the weekly reset, whatever day that is, and
every other run skips at almost no cost. The user is not asked anything.

Create the routine with push notifications on, so a `notify` message reaches the owner.

Routine prompt:

> Run the balance check:
> `[ -d ~/.agents-contributing/tools ] || git clone --depth 1 https://github.com/matipojo/agents-contributing ~/.agents-contributing/tools; bash ~/.agents-contributing/tools/skills/check-balance/check.sh --spent-usd <cost>`,
> where `<cost>` is this session's cost so far (`get_session`, `external_metadata.usage.cost_usd`;
> leave the flag out if you cannot read it).
> If the result has `notify`, end the run with exactly that message.
> If the verdict is `skip` or `unknown`, stop. Otherwise do one agents-contributing task, run the
> check again, and repeat while the verdict allows it. Stop when usage reaches
> `stop_at_used_pct` or the session cost reaches `max_spend_usd`.

## Providers

### `claude-code` (default)

Reads the real usage windows, `five_hour` and `seven_day`, with no setup. It runs one tiny
headless request (`claude -p` with Haiku, no tools, no MCP servers, no saved session) and reads
the `rate_limit_event` that Claude Code reports for it. This works anywhere Claude Code is signed
in to a subscription, including cloud routines. One check costs a few hundred tokens.

The same event says what the run is charged to. In a cloud session that can be cloud credits
(`ccr_promotional`) instead of the subscription. Then work does not count against the windows,
and the check treats the credits as the pool to protect (see below).

### `declared`

For providers that do not expose usage. Set `declared.weekly_reset` (for example `"sun 09:00"`)
and `declared.timezone` (for example `Asia/Jerusalem`). The check then only knows the time to
reset, not how much is used.

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
- If the run is charged to cloud credits, the windows do not apply. How much is left is not
  exposed, even to `/usage` in a cloud session, so credits are donated only in the last
  `credits.lead_days` (3) days before they expire, at most `credits.daily_usd` ($15) per daily run.
  When they run out, the next check falls back to the subscription windows.
- `credits.remind_days` (7) before the credits expire, one run returns `notify`: a reminder to
  check `/usage` and use them, since the routine cannot spend a large amount in the last days.
- Never contribute when the run is charged to paid extra usage.

## Rules

- The user's own work always comes first. When unsure, skip.
- Never report token counts or plan details anywhere public.
