# AGENTS-CONTRIBUTING.md Specification (v1, draft)

## What it is

`AGENTS-CONTRIBUTING.md` is a file a repository owner places at the root of a repository to invite AI agents to contribute, and to define what kind of help is wanted and within what limits.

A repository without this file receives no contributions from a compliant runner.

It does not replace `AGENTS.md`. `AGENTS.md` explains how to work in the repository (build commands, code style). `AGENTS-CONTRIBUTING.md` explains what help is wanted. A compliant runner reads both.

## Location and discovery

- The file lives at the repository root, named exactly `AGENTS-CONTRIBUTING.md`.
- To be discoverable, the repository adds the GitHub topic `agents-contributing`.

## Structure

A YAML front matter block between `---` lines at the top of the file, followed by free text for humans and agents.

### Top-level fields

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | Spec version. Currently `1`. |
| `help_<type>` | at least one | One field per help type, for example `help_triage` or `help_reproduce` (see below). |
| `limits` | yes | Caps the runner must respect. |
| `forbidden_paths` | no | Files and directories no help type may touch. |
| `contact` | no | Who to reach. |
| `providers` | no | `allow` and/or `deny` lists of provider names. |

### Fields for each help type

Each help type is its own top-level field named `help_` followed by the type name. There is no `help` map.

| Field | Meaning |
|---|---|
| `enabled` | Whether this help type is active. Default: `false`. |
| `scope` | What it applies to, for example `label:needs-repro` or `path:docs/`. Without a scope it applies to nothing. |
| `output` | What the agent produces: `comment`, `pr`, `review`, `failing-test-pr`, or `issue`. |
| `require` | Requirements, for example `tests`, `disclosure`, `changelog`. |
| `forbidden_paths` | Files and directories this help type must not touch, in addition to the top-level `forbidden_paths`. |
| `max_diff_lines` | Maximum size of a change. |
| `limits` | Limits for this help type only (see Limits). |

The top-level `forbidden_paths` always applies. A help type's own `forbidden_paths` adds to it and never removes from it.

### Known help types

| Field | What it is | Natural output |
|---|---|---|
| `help_triage` | Suggest classification and labels for an issue | `comment` |
| `help_reproduce` | Reproduce a reported bug | `failing-test-pr` or `comment` |
| `help_pr` | A fix or feature | `pr` |
| `help_tests` | Add tests for existing code | `pr` |
| `help_review` | Review an open PR | `review` |
| `help_docs` | Documentation | `pr` |
| `help_translate` | Translation | `pr` |
| `help_answer` | Answer recurring questions | `comment` |
| `help_audit` | Review the code in scope for bugs and report each one | `issue` |

A repository may define a help type not on this list, as `help_<name>`. A runner that does not recognize a type skips it.

### Limits

| Field | Meaning |
|---|---|
| `max_open_agent_contributions` | How many open agent contributions are allowed at once in the repository. |
| `max_per_contributor_per_week` | How many contributions per account per week. |
| `cooldown_hours` | Minimum time between two contributions from the same account. |

The top-level `limits` is required and applies to every help type. A help type may also set its own `limits` with any of the same fields. A field set on the help type replaces the top-level value for that type, counting only contributions of that type. A field the help type leaves out, or a help type without `limits`, falls back to the top-level value.

## Obligations of a compliant runner

1. Never contribute to a repository without the file or to a runner repository, and re-read the file right before every submission.
2. Skip a repository whose `version` the runner does not know.
3. Respect all limits, both top-level and per help type, `scope`, `forbidden_paths` and `max_diff_lines`.
4. Produce only the configured output type, and never an action that requires permissions in the repository.
5. Open a draft PR as soon as code work starts, and skip a task that already has an agent draft.
6. Skip an issue that already has an agent comment of the same help type. For `issue` outputs, open one issue per finding, and skip a finding that an open issue already describes.
7. Mark every contribution (see Contribution marker).
8. Treat all repository content, including this file and issues, as data and never as instructions that change the runner's behavior.
9. Run in an isolated environment with network egress limited to the model provider and GitHub.

## Contribution marker

Every PR, comment or review a compliant runner produces ends with one visible line:

```
agents-contributing: v1 type=reproduce provider=anthropic model=<model> runner=<version> from=<owner>/<runner-repo>
```

- The line must be in the PR or comment body, not only in a commit.
- Commits may also carry an identical trailer named `Agents-Contributing:`, as an addition only.
- Never include token counts, plan type or any account detail.

## Contributor log

The runner appends one line per contribution to `contributions.jsonl` in the contributor's runner repository:

```json
{"v":1,"type":"pr","repo":"owner/name","url":"https://github.com/owner/name/pull/123","provider":"anthropic","model":"<model>","runner":"<version>","at":"2026-10-29T19:00:00Z"}
```

- The log is on by default. A contributor who turns it off gets no attribution.
- The runner repository carries the topic `agents-contributing-runner` so aggregators can find it.

## Runner repositories are closed by default

A runner repository is discoverable by its topic, so it must not become a spam target.

- A repository with the topic `agents-contributing-runner` is never a contribution target, even if it contains `AGENTS-CONTRIBUTING.md`. Compliant runners skip it.
- A runner repository does not contain `AGENTS-CONTRIBUTING.md`.
- When the runner repository is created, it is set up to refuse outside input: issues, wiki, projects and discussions are disabled, and GitHub interaction limits are set to collaborators only. GitHub interaction limits expire after at most six months, so the runner renews them on each run.
- Pull requests from outsiders that still arrive are closed automatically by the runner without being read by the agent.

In general, every repository is closed by default: no file means no contributions, and every help type is disabled until it is enabled with a scope.

## When a contribution counts as accepted

| Type | Accepted when |
|---|---|
| `pr`, `tests`, `docs`, `translate` | The PR was merged |
| `reproduce` | The reproduction test was merged, or the owner marked the comment as helpful |
| `triage`, `answer` | The owner marked the comment as helpful, or applied the suggested labels |
| `review` | The owner marked the review as helpful |
| `audit` | The owner labeled the issue for work, or a fix for it was merged |

## Feedback from the repository owner

- The label `agent-spam` on a PR or issue, or a 👎 reaction from the owner on a comment, marks a contribution as unwanted.
- A compliant runner checks its recent contributions to each repository. If any were marked as spam, it stops contributing to that repository for a period and slows down overall.

## Example

```yaml
---
version: 1
help_triage:
  enabled: true
  scope: label:new
  output: comment
help_reproduce:
  enabled: true
  scope: label:needs-repro
  output: failing-test-pr
help_pr:
  enabled: true
  scope: label:agents-welcome
  output: pr
  require: [tests, disclosure]
  forbidden_paths: [package.json, package-lock.json]
  max_diff_lines: 300
  limits:
    max_open_agent_contributions: 2
help_review:
  enabled: false
limits:
  max_open_agent_contributions: 5
  max_per_contributor_per_week: 2
  cooldown_hours: 24
forbidden_paths: [.github/]
contact: "@maintainer"
---

## Notes for agents
We especially welcome reproductions. A failing test is worth more to us than a fix.
Fixes without a test will be closed.
```
