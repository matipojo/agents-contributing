import { test } from "node:test";
import assert from "node:assert/strict";
// An adapter and its agent import each other, and only loading the adapter first works.
import "../src/balance/adapters/index.ts";

test("a launched agent gets none of the runner's secrets in its environment", async () => {
  const { agentEnv } = await import("../src/balance/adapters/agent-env.ts");
  const { CLAUDE_ENV } = await import("../src/balance/adapters/claude-code/agent.ts");
  const { CODEX_ENV } = await import("../src/balance/adapters/codex/agent.ts");
  const env = {
    PATH: "/bin", HOME: "/home/me", HTTPS_PROXY: "http://proxy", CI: "true",
    AGENTS_CONTRIBUTING_GITHUB_TOKEN: "ghp_x", GH_TOKEN: "ghp_y", GITHUB_TOKEN: "ghs_z", SECRETS_JSON: "{}",
    AWS_SECRET_ACCESS_KEY: "aws", NPM_TOKEN: "npm", GIT_CONFIG_VALUE_0: "AUTHORIZATION: basic abc", MY_APP_SETTING: "1",
    CLAUDE_CODE_OAUTH_TOKEN: "claude", ANTHROPIC_BASE_URL: "https://api", CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
    OPENAI_API_KEY: "openai", CODEX_HOME: "/codex",
  };
  const claude = agentEnv(CLAUDE_ENV, env);
  assert.deepEqual(Object.keys(claude).sort(), ["ANTHROPIC_BASE_URL", "CI", "CLAUDE_CODE_OAUTH_TOKEN", "HOME", "HTTPS_PROXY", "PATH"]);
  const codex = agentEnv(CODEX_ENV, env);
  assert.deepEqual(Object.keys(codex).sort(), ["CI", "CODEX_HOME", "HOME", "HTTPS_PROXY", "OPENAI_API_KEY", "PATH"]);
  // A repository whose checks need one more variable gets it only by name.
  assert.equal(agentEnv(CLAUDE_ENV, { ...env, AGENTS_CONTRIBUTING_AGENT_ENV: "MY_APP_SETTING, MISSING" }).MY_APP_SETTING, "1");
});

test("Claude Code is launched confined: prompt after --, no bypass, commands only in the sandbox", async () => {
  const { claudeArgs, SANDBOX } = await import("../src/balance/adapters/claude-code/agent.ts");
  for (const write of [false, true]) {
    const args = claudeArgs("--tools Bash do this", write);
    assert.deepEqual(args.slice(-2), ["--", "--tools Bash do this"], "the prompt can never be read as an option or a tool name");
    assert.ok(args.includes("--restricted"));
    assert.ok(!args.includes("bypassPermissions") && !args.includes("--dangerously-skip-permissions"));
  }
  const read = claudeArgs("p", false);
  assert.equal(read[read.indexOf("--tools") + 1], "Read,Grep,Glob", "a read-only run cannot run or write anything");
  assert.ok(!read.includes("--settings"));
  const write = claudeArgs("p", true);
  const settings = JSON.parse(write[write.indexOf("--settings") + 1]!) as typeof SANDBOX;
  assert.equal(settings.sandbox.enabled, true);
  assert.equal(settings.sandbox.failIfUnavailable, true, "no sandbox, no run");
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  assert.deepEqual(settings.sandbox.network, { allowedDomains: [], strictAllowlist: true }, "commands get no network");
  assert.ok(settings.sandbox.credentials.envVars.some((v) => v.name === "CLAUDE_CODE_OAUTH_TOKEN" && v.mode === "deny"));
  assert.ok(settings.sandbox.credentials.files.some((f) => f.path === "~/.config/gh" && f.mode === "deny"));
});

test("after the agent worked in a checkout, the runner's git runs nothing planted there", async () => {
  const { gitAfterAgent } = await import("../src/runner/flow.ts");
  const { execFileSync } = await import("node:child_process");
  const { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "ac-planted-"));
  const home = mkdtempSync(join(tmpdir(), "ac-planted-home-"));
  const ran = (name: string) => existsSync(join(dir, "..", `${name}-${dir.split("/").pop()}`));
  const plant = (name: string) => `touch ${JSON.stringify(join(dir, "..", `${name}-${dir.split("/").pop()}`))}`;
  const realHome = process.env.HOME;
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "one\n");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base"], { cwd: dir });
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

    // What code from the repository could leave behind: hooks, a file-system monitor, an
    // external diff, and a filter program named in the user's own git config.
    for (const hook of ["pre-commit", "post-commit", "post-index-change", "prepare-commit-msg"]) {
      writeFileSync(join(dir, ".git", "hooks", hook), `#!/bin/sh\n${plant("hook")}\n`);
      chmodSync(join(dir, ".git", "hooks", hook), 0o755);
    }
    writeFileSync(join(dir, "fsmonitor.sh"), `#!/bin/sh\n${plant("fsmonitor")}\n`);
    chmodSync(join(dir, "fsmonitor.sh"), 0o755);
    execFileSync("git", ["config", "core.fsmonitor", join(dir, "fsmonitor.sh")], { cwd: dir });
    execFileSync("git", ["config", "diff.external", plant("extdiff")], { cwd: dir });
    writeFileSync(join(home, ".gitconfig"), `[filter "evil"]\n\tclean = ${plant("filter")}; cat\n[core]\n\thooksPath = ${join(dir, ".git", "hooks")}\n`);
    writeFileSync(join(dir, ".gitattributes"), "* filter=evil\n");
    writeFileSync(join(dir, "a.txt"), "two\n");
    process.env.HOME = home;

    assert.match(gitAfterAgent(dir, "status", "--porcelain"), /a\.txt/);
    gitAfterAgent(dir, "add", "-A");
    assert.match(gitAfterAgent(dir, "diff", "--cached", "--numstat", "-z", base), /a\.txt/);
    assert.match(gitAfterAgent(dir, "diff", "--cached", "--no-ext-diff", "--no-textconv", base), /\+two/);
    gitAfterAgent(dir, "reset", "-q", "--soft", base);
    gitAfterAgent(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "change");
    for (const name of ["hook", "fsmonitor", "extdiff", "filter"]) assert.equal(ran(name), false, `${name} must not run`);

    // The same steps with plain git do run them, so the test would notice a planted program.
    writeFileSync(join(dir, "a.txt"), "three\n");
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "plain"], { cwd: dir, stdio: "ignore" });
    assert.equal(ran("hook") && ran("filter"), true, "plain git runs the planted programs");
  } finally {
    process.env.HOME = realHome;
    for (const name of ["hook", "fsmonitor", "extdiff", "filter"]) rmSync(join(dir, "..", `${name}-${dir.split("/").pop()}`), { force: true });
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
