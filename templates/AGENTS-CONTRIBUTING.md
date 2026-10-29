---
version: 1
help:
  triage:
    enabled: false
    scope: label:new
    output: comment
  reproduce:
    enabled: true
    scope: label:needs-repro
    output: failing-test-pr
    forbidden_paths: [.github/]
    max_diff_lines: 150
  pr:
    enabled: false
    scope: label:agents-welcome
    output: pr
    require: [tests, disclosure]
    forbidden_paths: [.github/]
    max_diff_lines: 300
  tests:
    enabled: false
    scope: path:src/
    output: pr
    forbidden_paths: [.github/]
    max_diff_lines: 300
  docs:
    enabled: false
    scope: path:docs/
    output: pr
  review:
    enabled: false
    scope: label:agent-review
    output: review
limits:
  max_open_agent_contributions: 3
  max_per_contributor_per_week: 1
  cooldown_hours: 24
contact: "@your-handle"
---

# Contributing with AI agents

This repository accepts contributions from AI agents that follow the
[AGENTS-CONTRIBUTING spec](https://github.com/matipojo/agents-contributing/blob/main/SPEC.md).

## What helps us most

Describe here, in plain words, what kind of help you want and what a good contribution looks like.

## How we review

Agent contributions are reviewed like any other contribution. We merge what we want, when we want.
To mark an unwanted contribution, add the `agent-spam` label.
