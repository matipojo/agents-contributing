import { test } from "node:test";
import assert from "node:assert/strict";

test("a GitHub login that can do more than contributing needs is pointed out", async () => {
  const { broadLoginNote } = await import("../src/runner/policy.ts");
  assert.equal(broadLoginNote(null), null, "a token without scopes, such as a fine-grained one");
  assert.equal(broadLoginNote(["public_repo"]), null);
  assert.equal(broadLoginNote(["public_repo", "read:org"]), null, "read-only scopes add nothing to write with");
  const note = broadLoginNote(["gist", "read:org", "repo", "workflow"]);
  assert.match(note ?? "", /\(gist, repo, workflow\)/);
  assert.match(note ?? "", /separate GitHub account/);
});

test("the token's scopes are read from GitHub's reply", async () => {
  const { GitHub } = await import("../src/runner/github.ts");
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ login: "me" }), {
    status: 200, headers: { "content-type": "application/json", "x-oauth-scopes": "repo, workflow" },
  })) as typeof fetch;
  try {
    const gh = new GitHub("t");
    assert.equal(gh.scopes, null);
    assert.equal(await gh.login(), "me");
    assert.deepEqual(gh.scopes, ["repo", "workflow"]);
    const anonymous = new GitHub(null);
    await anonymous.request("GET", "/user");
    assert.equal(anonymous.scopes, null, "without a token there are no scopes to report");
  } finally {
    globalThis.fetch = real;
  }
});
