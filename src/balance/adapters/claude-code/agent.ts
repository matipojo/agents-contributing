import { execFileSync } from "node:child_process";
import type { Agent } from "../../types.ts";
import { CLAUDE_BIN } from "./adapter.ts";

/**
 * Runs Claude Code for the contribution runner: `claude -p` in the checkout. Read-only runs
 * get only reading tools. Write runs may edit files and run commands without asking, which is
 * why the runner must run in an isolated, disposable environment (spec obligation 9).
 */
export const claudeAgent: Agent = {
  vendor: "anthropic",
  run({ cwd, prompt, write }) {
    const out = execFileSync(CLAUDE_BIN, [
      "-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config",
      ...(write
        ? ["--permission-mode", "bypassPermissions", "--tools", "Read,Grep,Glob,Edit,Write,Bash"]
        : ["--tools", "Read,Grep,Glob"]),
      prompt,
    ], { cwd, encoding: "utf8", timeout: 3_600_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const res = JSON.parse(out) as { result?: string; is_error?: boolean; modelUsage?: Record<string, { outputTokens?: number }> };
    if (res.is_error || typeof res.result !== "string") throw new Error(`Claude Code failed: ${out.slice(0, 300)}`);
    // The model that wrote most of the output did the work.
    const model = Object.entries(res.modelUsage ?? {}).sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0))[0]?.[0];
    return { text: res.result, model: model ?? "unknown" };
  },
};
