/** Variables a launched agent needs to find programs and reach the network. No secrets. */
const HARMLESS = new Set([
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "TZ", "TMPDIR", "CI",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
]);

/**
 * The environment for an agent the runner launches: the harmless variables and the ones its
 * provider reads (`own`). The agent runs a target repository's code, so the runner's GitHub
 * token and everything else stay out.
 */
export function agentEnv(own: RegExp, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => HARMLESS.has(name) || own.test(name)));
}
