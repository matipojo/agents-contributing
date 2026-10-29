import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateText } from "../src/spec.ts";

test("the template is valid with no warnings", () => {
  const r = validateText(readFileSync("templates/AGENTS-CONTRIBUTING.md", "utf8"));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("missing front matter is an error", () => {
  assert.equal(validateText("# hello").errors.length, 1);
});

test("unknown version, missing scope and missing limits are errors", () => {
  const r = validateText("---\nversion: 2\nhelp:\n  pr:\n    enabled: true\n    output: pr\nlimits: {}\n---\n");
  assert.ok(r.errors.some((e) => e.includes("Unknown version")));
  assert.ok(r.errors.some((e) => e.includes("no 'scope'")));
  assert.ok(r.errors.some((e) => e.includes("cooldown_hours")));
});

test("disabled help types are not checked further", () => {
  const r = validateText([
    "---", "version: 1", "help:", "  pr:", "    enabled: false",
    "limits:", "  max_open_agent_contributions: 1", "  max_per_contributor_per_week: 1", "  cooldown_hours: 1", "---",
  ].join("\n"));
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes("No help type is enabled")));
});
