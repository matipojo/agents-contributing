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
| `scope` | What it applies to, for example `label:agents:repro-wanted` or `path:docs/`. Without a scope it applies to nothing. |
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

Every PR, comment or review a compliant runner produces ends with one visible line, in one of these two forms:

```
agents-contributing: v1 type=reproduce provider=anthropic model=<model> runner=<version> from=<owner>/<runner-repo>
agents-contributing: v1 type=reproduce provider=anthropic model=<model> runner=<version> from=<owner>
```

- `from` is the contributor's runner repository, or only the contributor's account when they have none.
- The line must be in the PR or comment body, not only in a commit.
- Commits may also carry an identical trailer named `Agents-Contributing:`, as an addition only.
- Never include token counts, plan type or any account detail.

## Contributor log

The runner appends one line per contribution to `contributions.jsonl`: in the contributor's runner repository when they have one, otherwise on the contributor's machine. A runner repository is optional; it makes the log public.

```json
{"v":1,"type":"pr","repo":"owner/name","url":"https://github.com/owner/name/pull/123","provider":"anthropic","model":"<model>","runner":"<version>","at":"2026-10-29T19:00:00Z"}
```

- The log is on by default. A contributor who turns it off keeps only the attribution the markers carry.
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

## Labels

A repository may use any label in a `scope`. These names are recommended, so owners and
contributors read them the same way everywhere. Each starts with `agents:`, and a request
label ends in `-wanted`: it is an open request, not a record that the work was done. Only the
owner sets labels; a runner never does.

| Label | Set on | Meaning |
|---|---|---|
| `agents:fix-wanted` | issue | An agent may fix this (`help_pr`) |
| `agents:review-wanted` | pull request | An agent may review this (`help_review`) |
| `agents:repro-wanted` | issue | An agent may reproduce this bug (`help_reproduce`) |
| `agents:triage-wanted` | issue | An agent may suggest labels (`help_triage`) |
| `agents:rejected-spam` | issue, pull request | Rejected: noise or low quality (see below) |
| `agents:rejected-wrong` | issue, pull request | Rejected: the fix or finding is incorrect |
| `agents:rejected-out-of-scope` | issue, pull request | Rejected: not what this repository asked for |
| `agents:rejected-duplicate` | issue, pull request | Rejected: already reported or fixed |

Whether the work was done shows on the item itself: a pull request that says `Closes #N`, or
a review or comment with the contribution marker.

## Feedback from the repository owner

The owner rejects a contribution with one `agents:rejected-<reason>` label, so the contributor
learns why, and a compliant runner reacts to the reason. A 👎 reaction from the owner on a
comment counts as `agents:rejected-spam`. The owner may add a comment with details.

| Reason | What a compliant runner does |
|---|---|
| `spam` | Stops contributing to that repository for 30 days, and slows down overall. |
| `wrong` | Stops that help type in that repository for 7 days. |
| `out-of-scope` | Stops that help type in that repository for 7 days, and re-reads the file before the next one. |
| `duplicate` | No pause. It counts against the contribution in the contributor's record. |

A compliant runner checks its recent contributions to each repository for these labels before
it contributes there again.

## Example

```yaml
---
version: 1
help_triage:
  enabled: true
  scope: label:agents:triage-wanted
  output: comment
help_reproduce:
  enabled: true
  scope: label:agents:repro-wanted
  output: failing-test-pr
help_pr:
  enabled: true
  scope: label:agents:fix-wanted
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
