# Provider adapters

One folder per agent type. Each folder holds the adapter (`adapter.ts`), its tests
(`adapter.test.ts`) and a `README.md` with what is specific to that agent: how usage is read,
what a run can be charged to, and how a scheduled routine reports what it spent.

| Folder | Agent |
|---|---|
| [`claude-code/`](claude-code/README.md) | Claude Code, locally or in cloud routines |
| [`declared/`](declared/README.md) | Any agent that does not expose usage |

## Adding an agent

1. Create `<name>/adapter.ts` exporting an `Adapter` (see `../types.ts`):
   - `read(cfg, now)` returns the usage windows (name, used percent or `null`, reset time).
     If requests are charged to something other than those windows, such as credits, also
     return `billing` with a `label` and a `checkHint` for people.
   - `spentUsd()` (optional) returns what the current run has spent, if the agent can tell.
2. Add `<name>/adapter.test.ts`, with a real sample of the agent's output where there is one.
3. Add `<name>/README.md`: setup, what is read, and the routine notes.
4. Register it in `index.ts`.

The decision (`../decide.ts`) is the same for every agent and must not mention any of them.
