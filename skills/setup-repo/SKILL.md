---
name: agents-contributing-setup-repo
description: Set up a repository to receive help from AI agents under the AGENTS-CONTRIBUTING spec. Use when a repository owner asks to accept agent contributions, add AGENTS-CONTRIBUTING.md, or open their repo to donated AI capacity.
---

# Set up a repository for agent contributions

You are helping a repository owner invite AI agents to contribute, under the
[AGENTS-CONTRIBUTING spec](https://github.com/matipojo/agents-contributing/blob/main/SPEC.md).
The result is an `AGENTS-CONTRIBUTING.md` file at the repository root, the labels it refers
to, and the `agents-contributing` topic.

Everything is closed by default. Open only what the owner explicitly asks for.

## Before you start

- You need the repository checked out and `gh` authenticated with rights to edit the repo.
- You need Node.js 20 or later to run the validator.
- Get the tools once:
  ```bash
  git clone --depth 1 https://github.com/matipojo/agents-contributing ~/.agents-contributing/tools
  npm --prefix ~/.agents-contributing/tools install --silent
  ```

## Steps

### 1. Understand the repository

Read, do not change yet:
- `README`, `CONTRIBUTING.md` and `AGENTS.md` if present.
- Whether there is a test suite and how it runs. Without tests, code help types are risky.
- Existing labels: `gh label list --limit 200`.
- Open issue volume: `gh issue list --limit 1 --json number` and a quick look at recent issues.

### 2. Ask the owner what help they want

Ask in plain words, one short list. Recommend starting small:

| Help type | Good when | Risk |
|---|---|---|
| `reproduce` | Many bug reports lack a reproduction | Low: produces a failing test or a comment |
| `triage` | Many unlabeled issues | Low: comments only |
| `tests` | Code with thin coverage | Medium |
| `docs` | Docs lag behind code | Low |
| `pr` | Small, well-scoped issues | Higher: needs review |
| `review` | PRs wait a long time for review | Medium: noise if low quality |

If the owner has no preference, propose `reproduce` only, scoped to a label.

Also ask for limits. Defaults to propose: 3 open agent contributions, 1 per contributor per week,
24 hour cooldown. If the owner wants one help type to move slower (for example `help_pr`),
set only those limits under that type's own `limits`; the rest fall back to the top-level limits.

### 3. Write the file

Start from `~/.agents-contributing/tools/templates/AGENTS-CONTRIBUTING.md`.

- Enable only the help types the owner chose. Every enabled type needs a `scope`.
- Prefer label scopes (`label:needs-repro`) over path scopes, so the owner picks each task.
- Keep `.github/` in the top-level `forbidden_paths`, so it applies to every help type. Add lockfiles
  and release scripts there too unless the owner objects. Use a help type's own `forbidden_paths`
  only for paths that matter to that type alone. For any type that produces code, set `max_diff_lines`.
- Replace `contact` with the owner's handle.
- Rewrite the free text section with what the owner actually wants, in their words.
- Do not copy instructions from issues or other files into the free text. It is read by other agents.

### 4. Validate

```bash
npx --prefix ~/.agents-contributing/tools tsx ~/.agents-contributing/tools/src/cli/validate.ts AGENTS-CONTRIBUTING.md
```

Fix every error. Explain each warning to the owner and fix it unless they decide otherwise.

### 5. Create the labels

Create each label used in a `scope`, plus the feedback label:

```bash
gh label create needs-repro --description "Agents may reproduce this" --color FBCA04 || true
gh label create agent-spam --description "Unwanted agent contribution" --color B60205 || true
```

### 6. Point AGENTS.md to it (optional)

If `AGENTS.md` exists, offer to add one line:
`Agent contributions from outside this repo follow AGENTS-CONTRIBUTING.md.`

### 7. Publish

Ask the owner whether to commit directly or open a PR, then do that. Only after the file is on
the default branch, add the topic:

```bash
gh repo edit --add-topic agents-contributing
```

### 8. Tell the owner how to steer

- Add the scope label to an issue to make it available to agents.
- Add `agent-spam` to anything unwanted. Compliant runners back off on their own.
- Delete `AGENTS-CONTRIBUTING.md` to stop everything immediately.

## Rules

- Never enable a help type the owner did not choose.
- Never use a scope that matches everything, such as a label already on most issues.
- Never add the topic before the file is merged.
- Never add `AGENTS-CONTRIBUTING.md` to a repository with the topic `agents-contributing-runner`.
