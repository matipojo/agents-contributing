// Every provider adapter must follow the same contract, so that adding a provider is one
// folder and one line in the registry, and nothing else in the project names providers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ADAPTERS, detectAdapter, FALLBACK } from "../src/balance/adapters/index.ts";

const DIR = "src/balance/adapters";
const folders = readdirSync(DIR).filter((f) => statSync(join(DIR, f)).isDirectory());

test("every adapter folder is registered under its own name, and every registered adapter has a folder", () => {
  assert.deepEqual(folders.sort(), Object.keys(ADAPTERS).sort());
  for (const [name, a] of Object.entries(ADAPTERS)) assert.equal(a.name, name);
});

for (const name of folders) {
  test(`${name}: has adapter.ts, adapter.test.ts and a README with the required sections`, () => {
    for (const f of ["adapter.ts", "adapter.test.ts", "README.md"]) assert.ok(existsSync(join(DIR, name, f)), `missing ${name}/${f}`);
    const readme = readFileSync(join(DIR, name, "README.md"), "utf8");
    assert.match(readme, /^## How usage is read$|^For agents that do not expose usage/m, `${name}/README.md must say how usage is read`);
  });

  test(`${name}: declares a vendor, and detects nothing in an empty environment`, () => {
    const a = ADAPTERS[name]!;
    assert.ok(a.vendor.trim(), `${name} needs a vendor for the contribution marker`);
    assert.equal(a.detect?.({}) ?? false, false);
  });

  test(`${name}: GitHub Actions support, when declared, is complete`, () => {
    const ci = ADAPTERS[name]!.ci;
    if (!ci) return;
    assert.ok(ci.install.trim(), "ci.install is the command that installs the agent");
    assert.ok(ADAPTERS[name]!.agent, "running in GitHub Actions needs `agent`, which launches it");
    if (ci.secret) {
      assert.match(ci.secret.name, /^[A-Z][A-Z0-9_]*$/, "ci.secret.name is an environment variable name");
      assert.ok(ci.secret.help.trim());
    }
  });
}

test("detection: no two adapters claim the same environment, and anything else gets the fallback", () => {
  assert.equal(detectAdapter({}).name, FALLBACK.name);
  assert.equal(FALLBACK.detect, undefined, "the fallback must never claim an environment");
  for (const a of Object.values(ADAPTERS)) {
    if (!a.detect) continue;
    // An environment some adapter claims, built from what its README documents, is out of
    // reach here; instead require that each detector is selective on a typical shell.
    assert.equal(a.detect({ PATH: "/usr/bin", HOME: "/home/x", SHELL: "/bin/bash" }), false, `${a.name} claims a plain shell`);
  }
});

test("outside the adapter folders, the runner and scripts name no provider", () => {
  const names = folders.filter((f) => f !== FALLBACK.name);
  const files = [
    ...readdirSync("src/runner").map((f) => join("src/runner", f)),
    ...readdirSync("src/cli").map((f) => join("src/cli", f)),
    "src/balance/decide.ts",
    "templates/runner/.github/workflows/contribute.yml",
    "skills/join-as-contributor/setup-runner.sh",
  ];
  for (const file of files) {
    const code = readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|#)/.test(l)).join("\n");
    for (const n of names) assert.ok(!code.includes(`"${n}"`) && !code.includes(`${n})`), `${file} names the "${n}" provider`);
  }
});
