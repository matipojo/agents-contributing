/**
 * The environment a launched agent gets. The runner holds the contributor's GitHub token, and
 * a workflow may hold more; the agent runs code from a repository the contributor does not
 * know. So the agent starts from a short list of harmless variables and its own provider's,
 * never from the runner's whole environment.
 */

/** Needed to find and run programs, reach the network and run a repository's checks. No secrets. */
const HARMLESS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ",
  "TMPDIR", "TMP", "TEMP", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
  "CI", "NVM_DIR", "NVM_BIN", "VOLTA_HOME", "PNPM_HOME", "JAVA_HOME", "GOPATH", "GOROOT", "CARGO_HOME", "RUSTUP_HOME",
  "PYENV_ROOT", "VIRTUAL_ENV", "RUNNER_TEMP", "RUNNER_TOOL_CACHE",
  "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramFiles", "windir",
]);

/**
 * `own` matches the variables the agent's own provider reads, such as its login. More names
 * can be passed through with AGENTS_CONTRIBUTING_AGENT_ENV (separated by commas), for a
 * repository whose checks need one. Everything else is left out.
 */
export function agentEnv(own: RegExp, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const extra = new Set((env.AGENTS_CONTRIBUTING_AGENT_ENV ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && (HARMLESS.has(name) || extra.has(name) || own.test(name))) out[name] = value;
  }
  return out;
}
