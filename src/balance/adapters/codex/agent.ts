import { mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "../../types.ts";
import { CODEX_BIN, codexHome, findRollout } from "./adapter.ts";

/**
 * Runs Codex for the contribution runner: `codex exec` in the checkout, read-only or with
 * workspace writes. Network stays off inside the sandbox, so the agent cannot reach anything
 * the runner did not give it. The model comes from the session file Codex saves.
 */
export const codexAgent: Agent = {
  vendor: "openai",
  run({ cwd, prompt, write }) {
    const out = join(mkdtempSync(join(tmpdir(), "ac-codex-")), "last.txt");
    const events = execFileSync(CODEX_BIN, [
      "exec", "--json", "--skip-git-repo-check", "--sandbox", write ? "workspace-write" : "read-only",
      "-o", out, prompt,
    ], { cwd, encoding: "utf8", timeout: 3_600_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const threadId = /"thread_id":"([^"]+)"/.exec(events)?.[1];
    const file = threadId ? findRollout(join(codexHome(), "sessions"), threadId) : null;
    const model = file ? /"model":"([^"]+)"/.exec(readFileSync(file, "utf8"))?.[1] : undefined;
    return { text: readFileSync(out, "utf8"), model: model ?? "unknown" };
  },
};
