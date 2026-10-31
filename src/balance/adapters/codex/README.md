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

## In GitHub Actions: not yet

Codex can use a ChatGPT subscription in CI only by restoring its `auth.json` from a secret and
writing the refreshed file back after every run
([OpenAI's guide](https://developers.openai.com/codex/auth/ci-cd-auth)). Writing a secret back
needs a token with far more access than the runner's `public_repo` token, so the workflow does
not support Codex yet. Run the runner from a machine where Codex is signed in instead, with the
routine prompt in `skills/check-balance/SKILL.md`.

## Inside a Codex routine or automation

When the runner is called from Codex itself (`run.ts next`), Codex sets `CODEX_THREAD_ID` for the
commands it runs. The adapter then reads the limits from that session's own file, instead of
launching a second Codex, which its sandbox would refuse.
