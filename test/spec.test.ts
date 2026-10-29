import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectiveForbiddenPaths, effectiveLimits, validateText } from "../src/spec.ts";

test("the template is valid with no warnings", () => {
  const r = validateText(readFileSync("templates/AGENTS-CONTRIBUTING.md", "utf8"));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("missing front matter is an error", () => {
  assert.equal(validateText("# hello").errors.length, 1);
});

test("unknown version, missing scope and missing limits are errors", () => {
  const r = validateText("---\nversion: 2\nhelp_pr:\n  enabled: true\n  output: pr\nlimits: {}\n---\n");
  assert.ok(r.errors.some((e) => e.includes("Unknown version")));
  assert.ok(r.errors.some((e) => e.includes("no 'scope'")));
  assert.ok(r.errors.some((e) => e.includes("cooldown_hours")));
});

test("disabled help types are not checked further", () => {
  const r = validateText([
    "---", "version: 1", "help_pr:", "  enabled: false",
    "limits:", "  max_open_agent_contributions: 1", "  max_per_contributor_per_week: 1", "  cooldown_hours: 1", "---",
  ].join("\n"));
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes("No help type is enabled")));
});

test("a nested 'help' map is rejected", () => {
  const r = validateText("---\nversion: 1\nhelp:\n  pr:\n    enabled: false\nlimits: {}\n---\n");
  assert.ok(r.errors.some((e) => e.includes("'help' is not a field")));
  assert.ok(r.errors.some((e) => e.includes("No help type defined")));
});

test("a help type's own limits override the top-level ones field by field", () => {
  const r = validateText([
    "---", "version: 1",
    "help_pr:", "  enabled: false", "  limits:", "    cooldown_hours: 72",
    "help_triage:", "  enabled: false",
    "limits:", "  max_open_agent_contributions: 3", "  max_per_contributor_per_week: 1", "  cooldown_hours: 24", "---",
  ].join("\n"));
  assert.deepEqual(r.errors, []);
  assert.ok(r.data);
  assert.deepEqual(effectiveLimits(r.data, "pr"),
    { max_open_agent_contributions: 3, max_per_contributor_per_week: 1, cooldown_hours: 72 });
  assert.deepEqual(effectiveLimits(r.data, "triage"),
    { max_open_agent_contributions: 3, max_per_contributor_per_week: 1, cooldown_hours: 24 });
});

test("invalid per-type limits are errors", () => {
  const r = validateText([
    "---", "version: 1",
    "help_pr:", "  enabled: true", "  scope: label:x", "  output: comment", "  limits:", "    cooldown_hours: -1",
    "limits:", "  max_open_agent_contributions: 3", "  max_per_contributor_per_week: 1", "  cooldown_hours: 24", "---",
  ].join("\n"));
  assert.ok(r.errors.some((e) => e.includes("help_pr.limits.cooldown_hours")));
});

test("top-level forbidden_paths apply to every help type and add to its own", () => {
  const r = validateText([
    "---", "version: 1",
    "help_pr:", "  enabled: true", "  scope: label:x", "  output: pr", "  max_diff_lines: 100",
    "  forbidden_paths: [package.json]",
    "limits:", "  max_open_agent_contributions: 3", "  max_per_contributor_per_week: 1", "  cooldown_hours: 24",
    "forbidden_paths: [.github/]", "---",
  ].join("\n"));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.data);
  assert.deepEqual(effectiveForbiddenPaths(r.data, "pr"), [".github/", "package.json"]);
});
