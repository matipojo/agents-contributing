/**
 * The rules a compliant runner enforces in code, never by asking the agent: limits,
 * forbidden paths, change size and required tests. Everything here is pure.
 */
import type { Limits } from "../spec.ts";

const MARKER_RE = /^agents-contributing: v1 type=(\S+)/m;

/** The help type in a contribution marker, or null when the text has no marker. */
export function markerType(text: string | null | undefined): string | null {
  return MARKER_RE.exec(text ?? "")?.[1] ?? null;
}

/** One earlier agent contribution in a repository, from its marker. */
export interface Contribution {
  type: string;
  author: string;
  open: boolean;
  at: Date;
}

/**
 * How many contributions of `type` this contributor may still make right now, and why not
 * when it is none. A limit the help type sets itself counts only that type; a limit it
 * inherits from the top level counts every type.
 */
export function allowance(
  limits: Limits, own: Partial<Limits>, type: string, me: string, past: Contribution[], now: Date,
): { left: number; reason: string } {
  const scoped = (field: keyof Limits) => (field in own ? past.filter((c) => c.type === type) : past);
  const weekAgo = now.getTime() - 7 * 24 * 3_600_000;

  const open = scoped("max_open_agent_contributions").filter((c) => c.open).length;
  const openLeft = limits.max_open_agent_contributions - open;
  if (openLeft <= 0) return { left: 0, reason: `${open} agent contributions are open (max_open_agent_contributions ${limits.max_open_agent_contributions}).` };

  const mine = scoped("max_per_contributor_per_week").filter((c) => c.author === me && c.at.getTime() >= weekAgo).length;
  const weekLeft = limits.max_per_contributor_per_week - mine;
  if (weekLeft <= 0) return { left: 0, reason: `${mine} contributions this week (max_per_contributor_per_week ${limits.max_per_contributor_per_week}).` };

  const last = Math.max(0, ...scoped("cooldown_hours").filter((c) => c.author === me).map((c) => c.at.getTime()));
  const readyAt = last + limits.cooldown_hours * 3_600_000;
  if (last > 0 && readyAt > now.getTime()) {
    return { left: 0, reason: `cooldown_hours (${limits.cooldown_hours}h) since the last contribution ends at ${new Date(readyAt).toISOString()}.` };
  }
  // A cooldown allows one contribution until it passes again.
  const coolLeft = limits.cooldown_hours > 0 ? 1 : Infinity;
  return { left: Math.min(openLeft, weekLeft, coolLeft), reason: "" };
}

/** One changed file, as `git diff --numstat` reports it. */
export interface Change {
  path: string;
  added: number;
  deleted: number;
}

export function parseNumstat(out: string): Change[] {
  return out.split("\n").filter(Boolean).map((l) => {
    const [a, d, ...p] = l.split("\t");
    return { path: p.join("\t"), added: Number(a) || 0, deleted: Number(d) || 0 };
  });
}

const isTest = (path: string) => /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(path);

/** Why a change may not be submitted, or an empty list when it may. */
export function checkChange(
  changes: Change[], rules: { forbidden: string[]; maxDiffLines?: number; require?: string[] },
): string[] {
  const errors: string[] = [];
  if (changes.length === 0) errors.push("The agent changed no files.");
  for (const c of changes) {
    const hit = rules.forbidden.find((f) => c.path === f || c.path.startsWith(f.endsWith("/") ? f : `${f}/`));
    if (hit) errors.push(`${c.path} is in forbidden_paths (${hit}).`);
  }
  const lines = changes.reduce((n, c) => n + c.added + c.deleted, 0);
  if (rules.maxDiffLines !== undefined && lines > rules.maxDiffLines) {
    errors.push(`The change is ${lines} lines, more than max_diff_lines (${rules.maxDiffLines}).`);
  }
  if (rules.require?.includes("tests") && !changes.some((c) => isTest(c.path))) {
    errors.push("The help type requires tests, and no test file changed.");
  }
  return errors;
}

/** The first JSON value in an agent's reply, which may wrap it in prose or a code fence. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text)?.[1];
  for (const candidate of [fenced, text]) {
    if (!candidate) continue;
    const start = candidate.search(/[[{]/);
    if (start < 0) continue;
    for (let end = candidate.length; end > start; end--) {
      const ch = candidate[end - 1];
      if (ch !== "]" && ch !== "}") continue;
      try {
        return JSON.parse(candidate.slice(start, end));
      } catch {
        // keep shrinking
      }
    }
  }
  throw new Error("The agent's reply has no JSON.");
}
