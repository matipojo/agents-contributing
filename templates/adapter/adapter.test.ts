import { test } from "node:test";
import assert from "node:assert/strict";
import { myAgent } from "./adapter.ts";

// Test what is specific to this agent: how its usage output is read (with a real sample of
// it pasted in), and that detect recognizes its environment. The contract itself is checked
// for every adapter by test/adapters.test.ts.
test("<name>: detects its own environment", () => {
  assert.equal(myAgent.detect?.({ MY_AGENT_SESSION_ID: "x" }), true);
});
