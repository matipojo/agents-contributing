import { execFileSync } from "node:child_process";
import type { Agent } from "../../types.ts";
import { agentEnv } from "../agent-env.ts";
import { CLAUDE_BIN } from "./adapter.ts";

/** What Claude Code itself reads to sign in and find its files. Nothing else of the runner's reaches it. */
export const CLAUDE_ENV = /^(ANTHROPIC_[A-Z0-9_]+|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CONFIG_DIR)$/;

/**
 * The sandbox for the commands a write run starts: a repository's own checks are code the
 * contributor does not know. Inside it there is no network (the runner installed the
 * dependencies before), writes stay in the checkout, the provider's login is not in the
 * environment, and the usual login files cannot be read. Without a working sandbox Claude
 * Code refuses to start (`failIfUnavailable`), and no command can ask to run outside it.
 * On Linux it needs bubblewrap and socat; on macOS nothing.
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
      files: [
        "~/.config/gh", "~/.git-credentials", "~/.netrc", "~/.ssh", "~/.gnupg", "~/.npmrc", "~/.aws", "~/.config/gcloud",
        "~/.docker", "~/.kube", "~/.claude/.credentials.json", "~/.codex",
      ].map((path) => ({ path, mode: "deny" })),
    },
  },
};

/**
 * The arguments for one run. `--restricted` keeps Claude Code's own file tools inside the
 * checkout and ignores settings files, including any the repository carries. A read-only run
 * gets only reading tools. A write run may edit files in the checkout and run commands, and
 * every command runs in the sandbox above; it never gets `bypassPermissions`.
 * The prompt comes after `--`: `--tools` takes a list, and would take the prompt as part of it.
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
