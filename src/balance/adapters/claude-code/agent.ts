import { execFileSync } from "node:child_process";
import type { Agent } from "../../types.ts";
import { agentEnv } from "../agent-env.ts";
import { CLAUDE_BIN } from "./adapter.ts";

export const CLAUDE_ENV = /^(ANTHROPIC_[A-Z0-9_]+|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CONFIG_DIR)$/;

/**
 * Where a write run's commands run, since a repository's checks are code the contributor does
 * not know: no network, writes only in the checkout, no subscription token and no login files.
 * Without a working sandbox Claude Code refuses to start. Linux needs bubblewrap and socat.
 */
export const SANDBOX = {
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: true,
    network: { allowedDomains: [] as string[], strictAllowlist: true },
    credentials: {
      envVars: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].map((name) => ({ name, mode: "deny" })),
      files: ["~/.config/gh", "~/.git-credentials", "~/.netrc", "~/.ssh", "~/.npmrc", "~/.aws", "~/.claude/.credentials.json"]
        .map((path) => ({ path, mode: "deny" })),
    },
  },
};

/**
 * `--restricted` keeps the file tools inside the checkout. The prompt follows `--` because
 * `--tools` takes a list and would take the prompt as part of it.
 */
export function claudeArgs(prompt: string, write: boolean): string[] {
  return [
    "-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--restricted",
    ...(write
      ? ["--tools", "Read,Grep,Glob,Edit,Write,Bash", "--permission-mode", "acceptEdits", "--settings", JSON.stringify(SANDBOX)]
      : ["--tools", "Read,Grep,Glob"]),
    "--", prompt,
  ];
}

/** Runs Claude Code for the contribution runner: `claude -p` in the checkout. */
export const claudeAgent: Agent = {
  run({ cwd, prompt, write }) {
    const out = execFileSync(CLAUDE_BIN, claudeArgs(prompt, write), {
      cwd, env: agentEnv(CLAUDE_ENV), encoding: "utf8", timeout: 3_600_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
    const res = JSON.parse(out) as { result?: string; is_error?: boolean; modelUsage?: Record<string, { outputTokens?: number }> };
    if (res.is_error || typeof res.result !== "string") throw new Error(`Claude Code failed: ${out.slice(0, 300)}`);
    // The model that wrote most of the output did the work.
    const model = Object.entries(res.modelUsage ?? {}).sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0))[0]?.[0];
    return { text: res.result, model: model ?? "unknown" };
  },
};
