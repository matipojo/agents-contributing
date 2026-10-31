// Copy this folder to src/balance/adapters/<name>/, replace <name> and <Name>, and register it
// in src/balance/adapters/index.ts. test/adapters.test.ts tells you what is still missing.
import type { Adapter } from "../../types.ts";

export const myAgent: Adapter = {
  // The folder name, and what users write as `provider:` in contributor.yml.
  name: "<name>",
  // The company, for the contribution marker: "provider=<vendor>".
  vendor: "<vendor>",

  // True only inside this agent. Find a variable the agent sets for the commands it runs:
  // ask it to run `env` once. Without one, leave detect out; users then set `provider:`.
  detect: (env) => Boolean(env.MY_AGENT_SESSION_ID),

  // How much of the subscription is used, and when each window resets. If the agent does
  // not expose usage, return windows with usedPct: null (see ../declared/adapter.ts); the
  // runner then contributes only near the reset, until the agent's own limit stops it.
  read(cfg, now) {
    return {
      provider: "<name>",
      source: "describe where the numbers came from",
      capturedAt: now,
      windows: [{ name: cfg.budget.window, usedPct: null, resetsAt: new Date(now.getTime() + 7 * 24 * 3_600_000) }],
    };
  },

  // Optional: what the current run has spent, in dollars, if the agent can tell.
  // spentUsd: () => null,

  // Optional: how to launch the agent from GitHub Actions or cron (see ../codex/agent.ts).
  // Routines do not need this: there the agent calls `run.ts next` itself.
  // agent: myAgentRunner,

  // Optional: how to install and sign it in on GitHub Actions. Needs `agent` too.
  // ci: { install: "npm install --global my-agent-cli", secret: { name: "MY_AGENT_TOKEN", command: "my-agent token", help: "Copy the token it prints." } },
};
