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

## How the runner launches it

When the runner launches Claude Code itself (GitHub Actions, cron), it runs `claude -p` in the
checkout, confined:

- `--restricted`: the file tools stay inside the checkout, and settings files are ignored,
  including any the target repository carries. Never `bypassPermissions`.
- A read-only task (audit, review) gets only `Read`, `Grep` and `Glob`.
- A write task (a fix) also gets `Edit`, `Write` and `Bash`, and every command runs in Claude
  Code's sandbox: no network, writes only in the checkout, the subscription token removed from
  the environment, and login files such as `~/.config/gh` and `~/.ssh` unreadable. The runner
  installs the repository's dependencies before, because the sandbox cannot download them.
- The sandbox must work or the run fails (`failIfUnavailable`). On Linux it needs `bubblewrap`
  and `socat`, which the workflow installs; on macOS nothing. On Ubuntu 24.04 an unprivileged
  bubblewrap also needs `kernel.apparmor_restrict_unprivileged_userns=0`, which the workflow sets.
- The agent's environment is a short list of harmless variables plus Claude Code's own
  (`ANTHROPIC_*`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`). To pass one more, for a
  repository whose checks need it, name it in `AGENTS_CONTRIBUTING_AGENT_ENV`.

The sandbox leaves empty placeholder files in the checkout for paths it protects (such as
`.env` or `.npmrc`) and lists them in `.git/info/exclude`, so they are never part of a change.

