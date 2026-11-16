import { test } from "node:test";
import assert from "node:assert/strict";
// An adapter and its agent import each other, and only loading the adapter first works.
import "../src/balance/adapters/index.ts";
import { agentEnv } from "../src/balance/adapters/agent-env.ts";
import { CLAUDE_ENV, claudeArgs, SANDBOX } from "../src/balance/adapters/claude-code/agent.ts";

test("a launched agent gets none of the runner's secrets in its environment", () => {
  const env = { PATH: "/bin", AGENTS_CONTRIBUTING_GITHUB_TOKEN: "x", GH_TOKEN: "y", SECRETS_JSON: "{}", CLAUDE_CODE_OAUTH_TOKEN: "c" };
  assert.deepEqual(Object.keys(agentEnv(CLAUDE_ENV, env)).sort(), ["CLAUDE_CODE_OAUTH_TOKEN", "PATH"]);
});

test("Claude Code is launched confined, with the prompt after --", () => {
  for (const write of [false, true]) {
    const args = claudeArgs("the prompt", write);
    assert.deepEqual(args.slice(-2), ["--", "the prompt"]);
    assert.ok(args.includes("--restricted") && !args.includes("bypassPermissions"));
  }
  const write = claudeArgs("p", true);
  const { sandbox } = JSON.parse(write[write.indexOf("--settings") + 1]!) as typeof SANDBOX;
  assert.equal(sandbox.enabled && sandbox.failIfUnavailable && !sandbox.allowUnsandboxedCommands, true);
  assert.deepEqual(sandbox.network.allowedDomains, []);
});
