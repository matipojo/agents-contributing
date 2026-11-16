import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/balance/config.ts";
import { SUPPORTED_TYPES } from "../src/runner/tasks.ts";

test("the contributor template lists help the runner can do", () => {
  const listed = loadConfig("templates/contributor.yml").help_types;
  assert.ok(listed.some((t) => (SUPPORTED_TYPES as readonly string[]).includes(t)));
});
