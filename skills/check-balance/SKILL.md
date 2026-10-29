---
name: agents-contributing-check-balance
description: Check how much unused AI subscription capacity is left before the usage window resets, and decide whether to donate it now. Use before any agents-contributing work, or when asked how much usage or how many tokens are left.
---

# Check the balance

Decides whether there is unused subscription capacity to donate right now, and how much.
Run it before starting any contribution, and again after each task.

## Setup

The tools must be installed:

```bash
git clone --depth 1 https://github.com/matipojo/agents-contributing ~/.agents-contributing/tools
npm --prefix ~/.agents-contributing/tools install --silent
```

The config lives at `~/.agents-contributing/contributor.yml`.
Set `AGENTS_CONTRIBUTING_HOME` to use another directory.

### Provider: `claude-code`

Claude Code passes usage limits to its status line command. On subscription plans this can
include `rate_limits.five_hour` and `rate_limits.seven_day`, each with `used_percentage` and
`resets_at`. A small capture command saves them for the balance check.

Add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.agents-contributing/tools/node_modules/.bin/tsx ~/.agents-contributing/tools/src/cli/statusline-capture.ts"
  }
}
```

If the user already has a `statusLine` command, keep it: set the environment variable
`AGENTS_CONTRIBUTING_NEXT_STATUSLINE` to their old command. The capture passes the same input
through and prints its output.

The cache fills the first time Claude Code renders the status line. If the fields are missing
on the user's plan or version, use the `declared` provider instead.

### Provider: `declared`

For providers that do not expose usage. Set `declared.weekly_reset` (for example `"sun 09:00"`)
and `declared.timezone` (for example `Asia/Jerusalem`). The check then only knows the time to
reset, not how much is used.

## Run

```bash
npx --prefix ~/.agents-contributing/tools tsx ~/.agents-contributing/tools/src/cli/check-balance.ts
```

Exit codes: `0` contribute, `10` skip, `2` unknown or error. Output is JSON.

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
