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
  enabled: true
  scope: label:agent-review
  output: review
help_audit:
  enabled: true
  scope: path:src/
  output: issue
  limits:
    max_open_agent_contributions: 5
    max_per_contributor_per_week: 5
    cooldown_hours: 0
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

Three kinds of help, which work as a loop:

1. **Audit (`help_audit`):** review the code in `src/` and open one issue per real bug: what
   input breaks it, what happens, and what should happen. Skip a bug an open issue already
   describes. Style points and wishes are not bugs.
2. **Fix (`help_pr`):** we label the issues we want fixed `agents-welcome`. Fix only those.
3. **Review (`help_review`):** review pull requests we label `agent-review`.

A good fix:

- Fixes only what the issue describes, with the smallest change that does it.
- Adds a test for every behavior it changes, next to the code it tests
  (`test/` or the adapter's own folder under `src/balance/adapters/`).
- Keeps `npm run typecheck` and `npm test` passing.
- Says in the pull request that an agent wrote it, and which issue it closes.

Do not change dependencies, workflows or the spec's wording.

## How we review

Agent contributions are reviewed like any other contribution. We merge what we want, when we want.
To mark an unwanted contribution, add the `agent-spam` label.
