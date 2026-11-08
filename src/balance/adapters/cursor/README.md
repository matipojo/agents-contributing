# Cursor

Provider name: `cursor`. Needs the Cursor CLI logged in once (`agent login`, which opens a
browser), or `CURSOR_AUTH_TOKEN` set.

## How usage is read

From the plan, not from an agent turn: one call to Cursor's dashboard service,
`POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` with
`Authorization: Bearer <access token>`, `connect-protocol-version: 1` and body `{}`. The Cursor
CLI itself uses this call. It costs nothing, unlike the Claude Code and Codex checks, which run
one small turn.

The token is `CURSOR_AUTH_TOKEN` when set, otherwise the one `agent login` saved:
`${XDG_CONFIG_HOME:-~/.config}/cursor/auth.json` on Linux, `~/.cursor/auth.json` on macOS and
`%APPDATA%\Cursor\auth.json` on Windows (the paths the Cursor CLI uses). API keys
(`CURSOR_API_KEY`) are not used: they were not tested against this call.

The answer has `billingCycleEnd` (epoch milliseconds) and `planUsage.totalPercentUsed` and
`planUsage.apiPercentUsed` (percent of the included usage, 0 and up). They become two windows
that reset together at the end of the billing cycle:

| Window | Cursor shows it when | Message in the answer |
|---|---|---|
| `monthly` (the default) | Auto is selected | "You've used 9% of your included total usage" |
| `monthly_api` | a named model is selected | "You've used 61% of your included API usage" |

The surplus is measured on `monthly`. If `monthly_api` is nearly full, the check waits, like
any other nearly full window. The billing cycle is monthly, so with the default `lead_hours: 24`
the check allows contributing only in the last day of the cycle.

Usage over 100% is read as it is, so the surplus is zero. If the answer changes shape, the check
returns `unknown` and nothing is donated. These calls are not documented by Cursor.

## In a routine

Use a Cursor automation (or any Cursor agent) with the prompt in `skills/contribute/SKILL.md`.
The runner recognizes it from `CURSOR_AGENT=1`, which Cursor sets for every shell command its
agent runs. The account that ran `agent login` in that environment is the one measured.

## Not supported: launching Cursor from GitHub Actions or cron

`agent -p` prints the answer and exits, but it has access to every tool, and without `--force`
its shell commands are rejected (they need an approval that nobody gives). Letting a runner
start it with `--force` and edit files has not been tried, so the adapter has no `agent` and no
`ci`. Run the runner from the Cursor agent itself instead.
