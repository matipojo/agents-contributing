---
name: agents-contributing-join
description: Join agents-contributing as a contributor who donates unused AI subscription capacity to open source. Use when someone asks to donate leftover tokens or usage, join agents-contributing, or set up a contributor runner.
---

# Join as a contributor

You are helping someone donate the unused part of their AI subscription to open source
repositories that ask for help, under the
[AGENTS-CONTRIBUTING spec](https://github.com/matipojo/agents-contributing/blob/main/SPEC.md).

At the end they have a daily routine that donates only when there is surplus. Nothing else is
required: no config, no runner repository, no extra token where `gh` is logged in.

## Before you start

Tell the user two things plainly, and continue only if they agree:

1. **Terms of service.** Subscriptions are meant for personal use. Running a subscription on
   tasks for other people's repositories may be restricted by their provider. They should check
   their provider's terms. Never share accounts or tokens between people.
2. **Security.** Their agent will read content written by strangers. Contributions must run
   in an isolated environment with no access to their files or secrets.

Check prerequisites: `node --version` (20 or later), `git --version`, and that `gh` is
installed.

## Steps

### 1. Make sure GitHub is logged in

Run `gh auth status`. If it fails, ask the user to run `gh auth login` once, in their terminal,
and wait. That is the only login: the agent's own provider is already signed in.

### 2. Create the daily routine

Create a daily routine with the scheduler the agent has: a Claude Code routine (`/schedule`),
a Codex automation, or a Cursor automation. Its prompt, the same for every agent:

> Follow `skills/contribute/SKILL.md` from https://github.com/matipojo/agents-contributing,
> section "Run it from a routine".

If the agent cannot schedule anything, give the user that prompt and tell them to run it daily.
A Codex automation runs only while the computer is awake; a day it misses is skipped.

A cloud routine has no `gh` login of the user's. Its environment then needs the
`AGENTS_CONTRIBUTING_GITHUB_TOKEN` secret: a classic token with only `public_repo`, made at
https://github.com/settings/tokens/new?scopes=public_repo&description=agents-contributing.
Tell the user where their provider keeps environment secrets. Never ask them to paste it in
the chat.

### 3. Try it once

Run the routine's work once now, with `--dry-run --force` on `next`, and show the user what it
would contribute. Nothing is written to GitHub.

### 4. Only if the user wants them

- **Their own choices** (which repositories, which help types, how much to give): write
  `~/.agents-contributing/contributor.yml` from `templates/contributor.yml`.
- **A public log** of their contributions: give them
  `bash ~/.agents-contributing/tools/skills/join-as-contributor/setup-runner.sh` to run in their
  terminal. It creates the runner repository, closed to outside input.

## Rules

- Never store a provider token in a file or a public repository. Only in a secret store.
- Never contribute to a repository that did not opt in with `AGENTS-CONTRIBUTING.md`.
- Never contribute to a repository with the topic `agents-contributing-runner`.
- Never run contribution work on the user's own machine outside an isolated environment.
