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

To change the defaults, write `~/.agents-contributing/contributor.yml` from
`templates/contributor.yml`. Set `AGENTS_CONTRIBUTING_HOME` to use another directory.

## Run it on a schedule

Contributions run unattended, in a scheduled routine. Schedule it **daily**: with `lead_hours: 24`
a daily run always lands once inside the day before the weekly reset, whatever day that is, and
every other run skips at almost no cost. The user is not asked anything.

Routine prompt:

> Run the balance check:
> `[ -d ~/.agents-contributing/tools ] || git clone --depth 1 https://github.com/matipojo/agents-contributing ~/.agents-contributing/tools; bash ~/.agents-contributing/tools/skills/check-balance/check.sh`.
> If the verdict is `skip` or `unknown`, stop. Otherwise do one agents-contributing task, run the check again,
> and repeat until the verdict is no longer `contribute` or usage reaches `stop_at_used_pct`.

## Providers

### `claude-code` (default)

Reads the real usage windows, `five_hour` and `seven_day`, with no setup. It runs one tiny
headless request (`claude -p` with Haiku, no tools, no MCP servers, no saved session) and reads
the `rate_limit_event` that Claude Code reports for it. This works anywhere Claude Code is signed
in to a subscription, including cloud routines. One check costs a few hundred tokens.

Optional, on the user's own machine: the status line capture makes the check free while it is
fresh (30 minutes). Add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.agents-contributing/tools/node_modules/.bin/tsx ~/.agents-contributing/tools/src/cli/statusline-capture.ts"
  }
}
```

To keep an existing `statusLine` command, set `AGENTS_CONTRIBUTING_NEXT_STATUSLINE` to it.

### `declared`

For providers that do not expose usage. Set `declared.weekly_reset` (for example `"sun 09:00"`)
and `declared.timezone` (for example `Asia/Jerusalem`). The check then only knows the time to
reset, not how much is used.

## Read the result

| verdict | What to do |
|---|---|
| `contribute` | Contribute. Stop when usage reaches `stop_at_used_pct`. Re-check after each task. |
| `contribute-until-limited` | Usage is not exposed. Contribute, and stop at the first limit message from the provider. Never retry around a limit. |
| `skip` | Do nothing. `reason` says why, for example the reset is too far away or the surplus is too small. |
| `unknown` | Do nothing. Tell the user the `reason` and how to fix the setup. |

If `stale` is true, the reading is old and the real usage may be higher. Contribute only one
task, then check again.

## How the decision is made

- Only within `lead_hours` before the window resets. Before that, the user may still need it.
- Always keep `margin_pct` of the window unused.
- Give `donate_fraction` of what remains after the margin.
- If any shorter window (such as five hours) is nearly full, wait for it to reset.
- Skip when the donation is below `min_surplus_pct`.

## Rules

- The user's own work always comes first. When unsure, skip.
- Never report token counts or plan details anywhere public.
