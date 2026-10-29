# Design decisions

Each decision is written as "We decided X because Y". They came out of a structured debate between
personas (maintainers, contributors, security, legal, data and spam researchers).

## Principles

1. We decided to build a protocol, not a platform: a runner that sends contributions and a file in each repository that says what is wanted. Because then there is no central server, no central keys and nothing in the middle to attack.
2. We decided the repository owner is fully responsible for what enters their repository and merges however they like, because that is how open source already works.
3. We decided against a trust model, random reviewers and a merge bot, because the repository owner is the only acceptance gate.
4. We decided the unit of surplus is "the window before a reset", not "the end of the month", because every provider resets on its own schedule.
5. We decided to support every provider through small adapters, because contributors use many different AI tools and plans.

## The AGENTS-CONTRIBUTING.md file

6. We decided a repository takes part only if it has `AGENTS-CONTRIBUTING.md` at its root, because unrequested automated contributions are spam.
7. We decided on the name `AGENTS-CONTRIBUTING.md`, because it mirrors the familiar `CONTRIBUTING.md`.
8. We decided the file defines what help is wanted and within what limits, while `AGENTS.md` keeps defining how to work in the repository, because these are two different questions.
9. We decided the file starts with structured front matter that the runner reads mechanically, followed by free text, because limits must be enforced in code, not interpreted.
10. We decided on an open list of help types: triage, reproduce, pr, tests, review, docs, translate and answer, because every repository needs something different.
11. We decided every help type has an on switch, a scope and an output, because that gives the owner exact control.
12. We decided an agent only produces comments, pull requests or reviews, never an action that needs permissions in the repository, because an outside runner has no permissions and should not.
13. We decided the owner sets limits on open agent contributions and contributions per contributor, because a popular repository would be flooded otherwise.
14. We decided the spec is versioned and runners skip versions they do not know, because the spec can then evolve without breaking repositories.
15. We decided deleting the file stops everything, and the runner re-reads it right before submitting, because an owner needs an immediate exit.

## Discovery and coordination

16. We decided discovery uses a GitHub topic, because GitHub search is already the directory.
17. We decided a runner opens a draft pull request as soon as it starts code work, and that is the claim, because other runners can see it and skip without central coordination.
18. We decided that for comment outputs, a runner skips an issue that already has an agent comment of the same type, because duplicate comments are noise.

## The contributor

19. We decided the contributor chooses which repositories or topics to support and which help types, because it is their donation.
20. We decided the contributor sets how much of the surplus to give and always keeps a margin, because donating must never hurt their own work.
21. We decided the runner only starts within a set number of hours before the reset, because before that the contributor may still need the capacity.

## Runner and safety

22. We decided the runner runs in isolated, disposable environments such as GitHub Actions, not on the contributor's machine, because every run then starts clean and is thrown away.
23. We decided the subscription is connected through the provider's long-lived token stored as a secret, because the run then uses the surplus without an API key.
24. We decided everything the runner reads from another repository, including `AGENTS-CONTRIBUTING.md` itself, is data and not instructions, because a malicious owner or issue author can plant prompt injection.
25. We decided to limit network egress to the AI provider and GitHub, and to sandbox shell commands, because then even a successful injection cannot send the token out.
26. We decided the runner uses a narrowly scoped GitHub token: public repositories, pull requests and comments only, because a compromised runner then does limited damage.
27. We decided runners update automatically only to signed releases, and only 72 hours after release, because that gives time to catch a malicious release.

## Runner repositories

28. We decided a contributor's runner repository carries the topic `agents-contributing-runner`, because aggregators need to find contributor logs.
29. We decided runner repositories are closed by default: no `AGENTS-CONTRIBUTING.md`, issues, wiki, projects and discussions disabled, interaction limited to collaborators, because a discoverable repository must not become a spam target.
30. We decided compliant runners never contribute to a repository with the runner topic, even if it has the file, because a runner repository is never a target.

## Transparency and legal

31. We decided every contribution carries a marker with provider, model and runner version, because the owner deserves to know what they are merging.
32. We decided to check with each provider whether running a subscription on other people's repositories is allowed, because subscriptions are meant for personal use.
33. We decided to verify open bugs in long-lived subscription tokens before relying on them, because some sessions have been reported not to recognize the plan.

## Finding contributions

34. We decided the main marker is a visible line at the end of the pull request or comment body, because the body always survives and GitHub search finds visible text.
35. We decided a commit trailer is only an addition, because squash merges can drop it.
36. We decided the marker never includes token counts or plan type, because that would reveal what the contributor pays.
37. We decided the runner appends each contribution to `contributions.jsonl` in the runner repository, because every contributor then has a full record without a server.
38. We decided the log is on by default and can be turned off, because contributions are public anyway, and turning it off only gives up attribution.
39. We decided a log line counts only after checking the contribution exists and was authored by the same account, because markers and logs alone can be faked.
40. We decided not to count contributions to the contributor's own repositories, because that is the cheapest way to inflate numbers.
41. We decided every help type defines when a contribution counts as accepted, because otherwise we would count activity, not value.
42. We decided an owner can label a contribution `agent-spam`, and the contributor's runner checks for it and slows itself down, because that is a feedback loop without any central authority.
43. We decided the aggregator is an open source script anyone can run, and the project runs one copy that publishes to GitHub Pages, because then nobody owns the data alone.
44. We decided the aggregator reads only what changed since its last run, because GitHub rate limits do not allow a full scan every time.
45. We decided not to show a leaderboard, only a page per repository and per contributor, because rankings encourage inflation.

## Implementation

46. We decided all tooling is TypeScript only, because one language keeps the tools simple to read and contribute to.
47. We decided the Claude Code adapter reads usage from a tiny headless `claude -p` request, because contributions run in scheduled routines where no status line is ever drawn, and Claude Code reports the usage windows for every request.
48. We decided every check reads usage fresh and never from a cache, and nothing is installed in the contributor's day-to-day setup, because usage only grows inside a window, an old reading overstates the surplus, and the routine is the only place the project runs.
49. We decided each help type is its own top-level field, such as `help_triage`, instead of an entry under a `help` map, because a flat file is easier to read, edit and diff than deep nesting.
50. We decided a help type may set its own limits, and any limit it leaves out falls back to the top-level one, because an owner may want riskier help types to move slower without repeating every limit.
51. We decided `forbidden_paths` can also be set at the top level, and a help type's own list only adds to it, because a path like `.github/` should be protected for every help type and a narrower list must never unprotect it.
52. We decided the balance check needs no config and no answers from the user, and the routine runs daily, because a daily run always lands once in the day before the weekly reset, whatever day the reset is.
53. We decided that when a run is charged to cloud credits instead of the subscription, the check protects the credits: it contributes only within `lead_hours` before they expire, and never when paid extra usage is being spent. Because cloud work does not move the subscription windows, so a weekly surplus would never stop the run, and the remaining credit amount is not exposed.
54. We decided the contributor chooses whether to donate the subscription, cloud credits or both, because they are two different pools and only the contributor knows what they still need.
55. We decided credits are donated only in the last three days before they expire, at most $15 per daily run, and the owner gets one reminder a week before, because the remaining amount is not exposed and a large unused balance cannot be spent usefully in the last day.
56. We decided to add an `audit` help type whose output is an `issue`, one per finding, because finding bugs is help a repository can ask for, and opening an issue needs no permissions. The owner still picks what gets fixed, by labeling the issue for `help_pr`.
