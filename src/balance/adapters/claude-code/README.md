# Claude Code

Provider name: `claude-code` (the default).

## How usage is read

No setup. The adapter runs one tiny headless request (`claude -p` with Haiku, no tools, no MCP
servers, no saved session) and reads the `rate_limit_event` from its `stream-json` output:

- `unifiedWindows.five_hour` and `unifiedWindows.seven_day`: `utilization` (0 to 1) and
  `resetsAt` (epoch seconds).
- `rateLimitType`: what the request is charged to. A window name means the subscription.

This works anywhere Claude Code is signed in to a subscription, including cloud routines.
One check costs a few hundred tokens. Set `AGENTS_CONTRIBUTING_CLAUDE_BIN` to use another binary.

These fields are not documented by Claude Code. If they change, the check returns `unknown`
and nothing is donated.

## Cloud session credits

In a cloud session, requests can be charged to cloud session credits
(`rateLimitType: "ccr_promotional"`, `resetsAt` is when they expire) instead of the
subscription. Then work does not move the windows at all. How much is left is not exposed,
not even by `/usage` inside a cloud session, so the credit rules in the skill apply.

## In a routine

- **What the run spent:** pass `--spent-usd` with the session's live cost from the
  `get_session` tool (`external_metadata.usage.cost_usd`). Without it, the adapter reads the
  last `cost-state` record in the session transcript, which Claude Code writes only now and
  then, so it can lag behind.
- **Notifications:** create the routine with push notifications on, so `notify` reaches the owner.

## In GitHub Actions

The runner repository's workflow installs Claude Code and runs it with
`CLAUDE_CODE_OAUTH_TOKEN`, a long-lived token for the subscription that `claude setup-token`
creates (`setup-runner.sh` asks for it). It lasts about a year; run the setup again to renew it.
Runs there have no session transcript, so there is no `spentUsd`; credit pools do not apply to them.
