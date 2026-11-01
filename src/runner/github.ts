/**
 * The few GitHub REST calls the runner needs. Reads work without a token on public
 * repositories; every write needs one. Only repository-scoped endpoints are used for reads,
 * so the runner also works where repository search is unavailable.
 */
import { execFileSync } from "node:child_process";

/**
 * The GitHub token to write with: AGENTS_CONTRIBUTING_GITHUB_TOKEN when set, otherwise the one
 * the user's GitHub CLI is already logged in with. Null means a dry run.
 */
export function findToken(): { token: string | null; source: string } {
  const own = process.env.AGENTS_CONTRIBUTING_GITHUB_TOKEN?.trim();
  if (own) return { token: own, source: "AGENTS_CONTRIBUTING_GITHUB_TOKEN" };
  try {
    const gh = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).trim();
    if (gh) return { token: gh, source: "gh auth token" };
  } catch {
    // no gh, or not logged in
  }
  return { token: null, source: "none" };
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string } | null;
  labels: { name: string }[];
  pull_request?: unknown;
  draft?: boolean;
  created_at: string;
  updated_at?: string;
  author_association?: string;  // OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, ...
  html_url: string;
}

export interface Repo {
  full_name: string;
  default_branch: string;
  topics?: string[];
  private: boolean;
  permissions?: { push?: boolean };
}

export class GitHub {
  constructor(private token: string | null, private api = process.env.AGENTS_CONTRIBUTING_GITHUB_API ?? "https://api.github.com") {}

  get canWrite(): boolean {
    return this.token !== null;
  }

  async request<T>(method: string, path: string, body?: unknown, accept = "application/vnd.github+json"): Promise<T> {
    const res = await fetch(`${this.api}${path}`, {
      method,
      headers: {
        accept,
        "x-github-api-version": "2022-11-28",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    if (res.status === 204) return undefined as T;
    return (accept.includes("json") ? res.json() : res.text()) as Promise<T>;
  }

  private write<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) throw new Error("Writing to GitHub needs a token. Set AGENTS_CONTRIBUTING_GITHUB_TOKEN.");
    return this.request<T>(method, path, body);
  }

  login(): Promise<string> {
    return this.request<{ login: string }>("GET", "/user").then((u) => u.login);
  }

  repo(name: string): Promise<Repo> {
    return this.request<Repo>("GET", `/repos/${name}`);
  }

  async exists(name: string): Promise<boolean> {
    try {
      await this.repo(name);
      return true;
    } catch (e) {
      if (/: 404 /.test((e as Error).message)) return false;
      throw e;
    }
  }

  /** A text file from a branch, or null when it does not exist. */
  async file(name: string, path: string, ref: string): Promise<string | null> {
    try {
      const f = await this.request<{ content: string; encoding: string }>("GET", `/repos/${name}/contents/${path}?ref=${encodeURIComponent(ref)}`);
      return Buffer.from(f.content, f.encoding === "base64" ? "base64" : "utf8").toString("utf8");
    } catch (e) {
      if (/: 404 /.test((e as Error).message)) return null;
      throw e;
    }
  }

  /** Issues and pull requests, newest first, up to `max`. */
  async issues(name: string, query: string, max = 300): Promise<Issue[]> {
    const out: Issue[] = [];
    for (let page = 1; out.length < max; page++) {
      const batch = await this.request<Issue[]>("GET", `/repos/${name}/issues?${query}&per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out.slice(0, max);
  }

  pullDiff(name: string, number: number): Promise<string> {
    return this.request<string>("GET", `/repos/${name}/pulls/${number}`, undefined, "application/vnd.github.diff");
  }

  reviews(name: string, number: number): Promise<{ user: { login: string } | null; body: string }[]> {
    return this.request("GET", `/repos/${name}/pulls/${number}/reviews?per_page=100`);
  }

  createIssue(name: string, title: string, body: string): Promise<Issue> {
    return this.write("POST", `/repos/${name}/issues`, { title, body });
  }

  createPull(name: string, p: { title: string; body: string; head: string; base: string }): Promise<Issue> {
    return this.write("POST", `/repos/${name}/pulls`, { ...p, draft: true });
  }

  review(name: string, number: number, body: string): Promise<{ html_url: string }> {
    return this.write("POST", `/repos/${name}/pulls/${number}/reviews`, { body, event: "COMMENT" });
  }

  fork(name: string): Promise<Repo> {
    return this.write("POST", `/repos/${name}/forks`, { default_branch_only: true });
  }

  /** Appends one line to a file in a repository, creating it if needed. */
  async appendLine(name: string, path: string, line: string, message: string): Promise<void> {
    let sha: string | undefined;
    let text = "";
    try {
      const f = await this.request<{ content: string; sha: string }>("GET", `/repos/${name}/contents/${path}`);
      sha = f.sha;
      text = Buffer.from(f.content, "base64").toString("utf8");
    } catch (e) {
      if (!/: 404 /.test((e as Error).message)) throw e;
    }
    if (text && !text.endsWith("\n")) text += "\n";
    await this.write("PUT", `/repos/${name}/contents/${path}`, {
      message, sha, content: Buffer.from(text + line + "\n").toString("base64"),
    });
  }

  /**
   * Environment for `git push` that authenticates with the token. It goes in the environment,
   * not the URL or the arguments, so a failed push never prints it.
   */
  gitAuthEnv(): NodeJS.ProcessEnv {
    if (!this.token) throw new Error("Pushing needs a GitHub login. Run `gh auth login` once.");
    const basic = Buffer.from(`x-access-token:${this.token}`).toString("base64");
    return { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}` };
  }
}
