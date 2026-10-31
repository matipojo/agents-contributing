#!/usr/bin/env -S npx tsx
/**
 * What the configured provider's adapter says, for shell scripts that must not name providers.
 *
 *   provider.ts name                 the provider in use (from contributor.yml, or detected)
 *   provider.ts ci-install           install the agent for GitHub Actions; exit 1 if unsupported
 *   provider.ts ci-secret <field>    the secret GitHub Actions needs: name, command or help
 *                                    (prints nothing when the provider needs none)
 *   provider.ts ci-env               in GitHub Actions: export that one secret, taken from
 *                                    SECRETS_JSON (the workflow's toJSON(secrets)), to GITHUB_ENV
 *
 * All take an optional config path last. Exit 1 when the provider cannot run in GitHub Actions.
 */
import { appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { DEFAULT_CONFIG_PATH, loadConfig } from "../balance/config.ts";
import { ADAPTERS } from "../balance/adapters/index.ts";

const [what, ...rest] = process.argv.slice(2);
const field = what === "ci-secret" ? rest.shift() : undefined;
const cfg = loadConfig(rest[0] ?? DEFAULT_CONFIG_PATH);
const adapter = ADAPTERS[cfg.provider];
if (!adapter) {
  console.error(`Unknown provider "${cfg.provider}".`);
  process.exit(2);
}
const unsupported = () => {
  console.error(`The "${adapter.name}" provider cannot run in GitHub Actions. See src/balance/adapters/${adapter.name}/README.md.`);
  process.exit(1);
};

if (what === "name") {
  console.log(adapter.name);
} else if (what === "ci-install") {
  if (!adapter.ci) unsupported();
  execSync(adapter.ci!.install, { stdio: "inherit" });
} else if (what === "ci-secret") {
  if (!adapter.ci) unsupported();
  const secret = adapter.ci!.secret as Record<string, string> | undefined;
  if (secret && field && secret[field]) console.log(secret[field]);
} else if (what === "ci-env") {
  if (!adapter.ci) unsupported();
  const name = adapter.ci!.secret?.name;
  const target = process.env.GITHUB_ENV;
  if (name && target) {
    const value = (JSON.parse(process.env.SECRETS_JSON ?? "{}") as Record<string, string>)[name];
    if (!value) {
      console.error(`The repository secret ${name} is missing. Run skills/join-as-contributor/setup-runner.sh again.`);
      process.exit(1);
    }
    // GitHub masks secret values in logs; a delimiter keeps any value on one variable.
    appendFileSync(target, `${name}<<__AC_EOF__\n${value}\n__AC_EOF__\n`);
  }
} else {
  console.error("Usage: provider.ts name | ci-install | ci-secret <name|command|help> | ci-env [config]");
  process.exit(2);
}
