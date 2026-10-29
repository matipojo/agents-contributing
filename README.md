# agents-contributing

Donate the unused part of your AI subscription to open source repositories that ask for help.

Most AI subscriptions reset on a schedule, and most people never use all of it. agents-contributing
is a small protocol that lets an agent spend what is left, right before the reset, on repositories
that opted in. There is no server and no platform: a file in each repository says what help is
wanted, and a runner on the contributor's side respects it.

**Site:** https://matipojo.github.io/agents-contributing/
**Spec:** [SPEC.md](SPEC.md)

## How it works

1. A repository owner adds `AGENTS-CONTRIBUTING.md` and the `agents-contributing` topic. The file
   says which kinds of help are welcome (reproductions, triage, tests, small fixes and more), which
   issues they apply to, and how many agent contributions the owner accepts.
2. A contributor's agent checks how much of their usage window is left before it resets. It keeps a
   reserve and only offers what would otherwise expire.
3. The agent sends a comment, a failing test or a pull request, marked as agent work. The owner
   reviews and merges whatever they want.

Everything is closed by default: no file means no contributions, every help type starts disabled,
and runner repositories never accept contributions.

## Skills

Point your agent at one of these:

| Skill | For |
|---|---|
| [setup-repo](skills/setup-repo/SKILL.md) | Repository owners who want agent help |
| [join-as-contributor](skills/join-as-contributor/SKILL.md) | People who want to donate leftover usage |
| [check-balance](skills/check-balance/SKILL.md) | Deciding whether there is surplus to donate right now |

## Tools

Requires Node.js 20 or later.

```bash
npm install
npm run validate -- path/to/AGENTS-CONTRIBUTING.md   # check a file against the spec
npm run check-balance                                  # decide whether to donate now
npm test
```

| Path | What it is |
|---|---|
| `src/spec.ts` | Spec types, validation and the contribution marker |
| `src/cli/validate.ts` | Validator for `AGENTS-CONTRIBUTING.md` |
| `src/cli/check-balance.ts` | Balance check, prints a JSON decision |
| `src/balance/` | The decision logic, and `adapters/`: one folder per agent type |
| `templates/` | Starting points for `AGENTS-CONTRIBUTING.md` and `contributor.yml` |
| `docs/` | The GitHub Pages site and the design decisions |

### Providers

| Adapter | How it reads usage |
|---|---|
| `claude-code` | Real usage and reset times from a tiny headless `claude -p` request. Works in scheduled routines |
| `codex` | Real usage and reset times from a tiny `codex exec` turn and its session file |
| `declared` | No usage, only a declared weekly reset time. Contributes until the provider refuses |

Each adapter has its own folder under `src/balance/adapters/`, with its code, tests and README.
Adding an agent means adding a folder; see [`src/balance/adapters/README.md`](src/balance/adapters/README.md).

## Before you join

Subscriptions are meant for personal use. Check your provider's terms before running yours on
other people's repositories, and never share an account or token with anyone.

## License

MIT
