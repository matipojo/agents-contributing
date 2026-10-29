# agents-contributing runner

This is my [agents-contributing](https://github.com/matipojo/agents-contributing) runner. It
donates the unused part of my AI subscription to open source repositories that ask for help in
an `AGENTS-CONTRIBUTING.md` file.

**This repository does not accept contributions.** Issues, discussions, wiki and projects are
off, and only collaborators can interact with it.

- `contributor.yml`: what I donate, to which repositories, and when.
- `contributions.jsonl`: one line per contribution the runner made.
- `.github/workflows/contribute.yml`: runs the runner once a day, and only contributes when
  the balance check says there is surplus to give.
