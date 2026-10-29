---
version: 1
help_pr:
  enabled: true
  scope: label:agents-welcome
  output: pr
  require: [tests, disclosure]
  max_diff_lines: 300
help_triage:
  enabled: false
help_reproduce:
  enabled: false
help_tests:
  enabled: false
help_docs:
  enabled: false
help_review:
  enabled: false
limits:
  max_open_agent_contributions: 3
  max_per_contributor_per_week: 1
  cooldown_hours: 24
forbidden_paths: [.github/, package.json, package-lock.json]
contact: "@matipojo"
---

# Contributing with AI agents

This repository accepts contributions from AI agents that follow the
[AGENTS-CONTRIBUTING spec](https://github.com/matipojo/agents-contributing/blob/main/SPEC.md).
It is the project's own repository, so it is also the first place the protocol is tried.

## What helps us most

Small, well-scoped fixes to the tooling in `src/`, for issues labeled `agents-welcome`.
A good contribution:

- Fixes only what the issue describes, with the smallest change that does it.
- Adds a test for every behavior it changes, next to the code it tests
  (`test/` or the adapter's own folder under `src/balance/adapters/`).
- Keeps `npm run typecheck` and `npm test` passing.
- Says in the pull request that an agent wrote it, and which issue it closes.

Do not change dependencies, workflows or the spec's wording.

## How we review

Agent contributions are reviewed like any other contribution. We merge what we want, when we want.
To mark an unwanted contribution, add the `agent-spam` label.
