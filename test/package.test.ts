import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  bin?: { "agents-contributing"?: string };
  files?: string[];
  private?: unknown;
  publishConfig?: { provenance?: boolean };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

test("package.json is set up to publish", () => {
  assert.equal(pkg.bin?.["agents-contributing"], "dist/cli/main.js");
  assert.deepEqual(pkg.files, ["dist", "templates", "SPEC.md", "README.md", "LICENSE"]);
  assert.equal(pkg.publishConfig?.provenance, true);
  assert.equal(Object.hasOwn(pkg, "private"), false);
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}).sort(), ["yaml"]);
  assert.equal(typeof pkg.devDependencies?.tsx, "string");
});

test("every workflow uses: line is pinned to a commit SHA", () => {
  const dirs = [".github/workflows", "templates/runner/.github/workflows"];
  const sha = /^[0-9a-f]{40}$/;
  let seen = 0;
  for (const dir of dirs) {
    const files = readdirSync(join(root, dir)).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
    assert.ok(files.length > 0, `${dir} has no workflow files`);
    for (const name of files) {
      const text = readFileSync(join(root, dir, name), "utf8");
      for (const line of text.split("\n")) {
        const code = (line.split("#")[0] ?? "").trim();
        const match = code.match(/(?:^|\s)uses:\s*(\S+)/);
        if (!match?.[1]) continue;
        const spec = match[1];
        const pin = spec.slice(spec.lastIndexOf("@") + 1);
        assert.match(pin, sha, `${dir}/${name} uses ${spec}, which is not a 40-character commit SHA`);
        seen += 1;
      }
    }
  }
  assert.ok(seen > 0, "no uses: lines were checked");
});
