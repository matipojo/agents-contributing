# Provider adapters

One folder per agent type. Each folder holds the adapter (`adapter.ts`), its tests
(`adapter.test.ts`) and a `README.md` with what is specific to that agent: how usage is read,
what a run can be charged to, and how a scheduled routine reports what it spent.

| Folder | Agent |
|---|---|
| [`claude-code/`](claude-code/README.md) | Claude Code, locally or in cloud routines |
| [`codex/`](codex/README.md) | OpenAI Codex CLI, signed in with ChatGPT |
| [`declared/`](declared/README.md) | Any agent that does not expose usage |

## Adding an agent

An agent works with no adapter at all: the runner falls back to `declared`, which needs no
usage reading and contributes only near the reset, until the agent's own limit stops it. Any
agent that can run a daily routine with the prompt in `skills/contribute/SKILL.md` can
contribute today.

An adapter makes it precise. It is one folder and one line, and nothing else in the project
changes:

1. Copy `templates/adapter/` to `src/balance/adapters/<name>/`.
2. Fill in `adapter.ts`. Required: `name`, `vendor`, `read`. Optional: `detect` (recognize
   the agent from the environment it sets), `spentUsd`, `agent` (launch it from GitHub
   Actions or cron) and `ci` (install and sign it in on GitHub Actions).
3. Write `adapter.test.ts` with a real sample of the agent's usage output, and the README.
4. Add one line to `index.ts`.
5. Run `npm test`. `test/adapters.test.ts` checks the contract for every adapter, and fails
   if anything outside this folder names a provider.

The runner, the workflow and the setup script ask the adapter (`src/cli/provider.ts`), so they
never need to change for a new agent.
