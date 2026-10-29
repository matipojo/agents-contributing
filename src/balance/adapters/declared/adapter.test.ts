import { test } from "node:test";
import assert from "node:assert/strict";
import { nextWeekly } from "./adapter.ts";

const now = new Date("2026-10-29T12:00:00Z");

test("nextWeekly finds the next Sunday midnight in UTC", () => {
  assert.equal(nextWeekly("sun 00:00", "UTC", now).toISOString(), "2026-11-01T00:00:00.000Z");
});

test("nextWeekly respects the time zone", () => {
  // Asia/Jerusalem is UTC+2 after the October DST change.
  assert.equal(nextWeekly("sun 09:00", "Asia/Jerusalem", now).toISOString(), "2026-11-01T07:00:00.000Z");
});

test("nextWeekly rolls over to next week when the time has passed", () => {
  assert.equal(nextWeekly("thu 11:00", "UTC", now).toISOString(), "2026-11-05T11:00:00.000Z");
});
