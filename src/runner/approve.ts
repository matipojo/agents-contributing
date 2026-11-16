/**
 * Approving a repository: the contributor's decision that the runner may contribute there,
 * and so that their agent may run that repository's code. Nothing else adds to the list.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Document, parseDocument } from "yaml";
import { HOME_REPO, isRepoName } from "../balance/config.ts";
import { HELP_PREFIX } from "../spec.ts";
import type { GitHub } from "./github.ts";
import { readFile } from "./flow.ts";

export interface Approval {
  repo: string;
  approved: boolean;
  /** What the repository asks for, as `type (scope)`, or why it was not approved. */
  asks?: string[];
  reason?: string;
}

/**
 * Checks each repository (public, not a runner repository, with a valid file), and writes the
 * ones that pass to `targets.repos` in the config at `path`, keeping the rest of the file.
 */
export async function approve(gh: GitHub, names: string[], path: string): Promise<Approval[]> {
  const results: Approval[] = [];
  for (const name of names) {
    if (!isRepoName(name)) { results.push({ repo: name, approved: false, reason: "not a repository name (owner/name)" }); continue; }
    try {
      const repo = await gh.repo(name);
      if (repo.private) { results.push({ repo: name, approved: false, reason: "private" }); continue; }
      if (repo.topics?.includes("agents-contributing-runner")) { results.push({ repo: name, approved: false, reason: "is a runner repository" }); continue; }
      const read = await readFile(gh, name);
      if (typeof read === "string") { results.push({ repo: name, approved: false, reason: read }); continue; }
      const asks = Object.entries(read.file)
        .filter(([k, v]) => k.startsWith(HELP_PREFIX) && (v as { enabled?: boolean })?.enabled === true)
        .map(([k, v]) => `${k.slice(HELP_PREFIX.length)} (${(v as { scope?: string }).scope ?? "no scope"})`);
      results.push({ repo: repo.full_name, approved: true, asks });
    } catch (e) {
      results.push({ repo: name, approved: false, reason: (e as Error).message.slice(0, 120) });
    }
  }
  const add = results.filter((r) => r.approved).map((r) => r.repo);
  if (add.length === 0) return results;

  // The whole list is written: a `targets.repos` in the file replaces the default list.
  // What only the environment approves (AGENTS_CONTRIBUTING_REPOS) stays there.
  let doc: Document;
  if (existsSync(path)) {
    doc = parseDocument(readFileSync(path, "utf8"));
  } else {
    doc = new Document({});
    doc.commentBefore = " Contributor config for agents-contributing. Every other setting keeps its default;\n see templates/contributor.yml for all of them.";
  }
  const had = (doc.toJS() as { targets?: { repos?: unknown } } | null)?.targets?.repos;
  const current = Array.isArray(had) ? had.filter(isRepoName) : [HOME_REPO];
  const repos = [...new Set([...current, ...add])];
  doc.setIn(["targets", "repos"], repos);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, doc.toString());
  return results;
}
