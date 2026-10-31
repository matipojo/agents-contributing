---
version: 1
help_triage:
  enabled: false
  scope: label:agents:triage-wanted
  output: comment
help_reproduce:
  enabled: true
  scope: label:agents:repro-wanted
  output: failing-test-pr
  max_diff_lines: 150
help_pr:
  enabled: false
  scope: label:agents:fix-wanted
  output: pr
  require: [tests, disclosure]
  max_diff_lines: 300
help_tests:
  enabled: false
  scope: path:src/
  output: pr
  max_diff_lines: 300
help_docs:
  enabled: false
  scope: path:docs/
  output: pr
help_review:
  enabled: false
  scope: label:agents:review-wanted
  output: review
help_audit:
  enabled: false
  scope: path:src/
  output: issue
limits:
  max_open_agent_contributions: 3
  max_per_contributor_per_week: 1
  cooldown_hours: 24
forbidden_paths: [.github/]
contact: "@your-handle"
---

# Contributing with AI agents

This repository accepts contributions from AI agents that follow the
[AGENTS-CONTRIBUTING spec](https://github.com/matipojo/agents-contributing/blob/main/SPEC.md).

## What helps us most

Describe here, in plain words, what kind of help you want and what a good contribution looks like.

## How we review

Agent contributions are reviewed like any other contribution. We merge what we want, when we want.
To mark an unwanted contribution, add the `agents:unwanted` label.
