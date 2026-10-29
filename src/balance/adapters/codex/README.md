# Codex

Provider name: `codex`. Needs the Codex CLI signed in with ChatGPT (`codex login`); an API key
has no plan limits to read.

## How usage is read

`codex exec --json` does not print the limits, but Codex saves them in the session file of
every turn (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<thread id>.jsonl`, `CODEX_HOME`
defaults to `~/.codex`). The adapter runs one tiny turn (`codex exec`, read-only sandbox, low
reasoning effort, no user config), takes the thread id from `thread.started`, and reads the last
`token_count` event's `rate_limits`:

- `primary` and `secondary`: `used_percent` (0 to 100), `window_minutes`, `resets_at` (epoch
  seconds). 300 minutes is named `five_hour` and 10080 minutes `seven_day`, as for other agents.
- `credits`: `has_credits`, `unlimited`, `balance`.

Set `AGENTS_CONTRIBUTING_CODEX_BIN` to use another binary. These fields are not documented by
Codex. If they change, the check returns `unknown` and nothing is donated.

## Credits

Codex credits are bought. They are spent only after a plan limit is reached
(`rate_limit_reached_type`), so the adapter reports that as paid usage and the check never
donates it. The weekly surplus is donated as usual.

## In a routine

- **What the run spent:** Codex does not report a cost, so there is no `spentUsd`.
- The probe counts against the plan like any turn, a few thousand mostly cached tokens.
