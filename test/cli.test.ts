import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");

function cli(args: string[]) {
  return spawnSync(process.execPath, [tsx, join(root, "src", "cli", "main.ts"), ...args], {
    encoding: "utf8",
    cwd: root,
  });
}

test("--version prints the package version", () => {
  const ran = cli(["--version"]);
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout.trim(), pkg.version);
});

test("--help lists the commands", () => {
  const ran = cli(["--help"]);
  assert.equal(ran.status, 0, ran.stderr);
  for (const command of ["balance", "next", "submit", "run", "validate", "provider"]) {
    assert.match(ran.stdout, new RegExp(`\\b${command}\\b`));
  }
});

test("an unknown command prints usage to stderr and exits 2", () => {
  const ran = cli(["no-such-command"]);
  assert.equal(ran.status, 2);
  assert.match(ran.stderr, /Usage: agents-contributing/);
  assert.match(ran.stderr, /\bbalance\b/);
  assert.equal(ran.stdout, "");
});

test("the build output runs --version from a temporary directory", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agents-contributing-build-"));
  try {
    const out = join(tmp, "dist");
    const tsc = join(root, "node_modules", "typescript", "lib", "tsc.js");
    const compiled = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json"), "--outDir", out], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(compiled.status, 0, compiled.stderr);
    // dist/cli/main.js and dist/runner/flow.js both read ../../package.json.
    cpSync(join(root, "package.json"), join(tmp, "package.json"));
    symlinkSync(join(root, "node_modules"), join(tmp, "node_modules"));
    const ran = spawnSync(process.execPath, [join(out, "cli", "main.js"), "--version"], { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout.trim(), pkg.version);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
