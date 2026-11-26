import test from "node:test";
import assert from "node:assert/strict";
import { buildCeoWakePayload, wakeAuthHeader, allowWake, CEO_BOT_ID } from "../src/ceoWake.ts";

test("CEO is primary", () => assert.equal(CEO_BOT_ID, "primary"));

test("payload for a request to Jared", () => {
  const p = buildCeoWakePayload("q1", "primary", "Check the PR", "dashboard", "2026-11-25T00:00:00Z");
  assert.equal(p.event, "hq.request");
  assert.equal(p.owner, "primary");
  assert.equal(p.orderId, "q1");
  assert.match(p.context, /pop=1/);
  assert.match(p.context, /BEN_INSTRUCTION/);
});

test("payload for a request to another bot names that bot", () => {
  const p = buildCeoWakePayload("q2", "chad", "x".repeat(900), "quick-capture", "t");
  assert.equal(p.owner, "chad");
  assert.ok(p.title.length <= 200);
  assert.ok(p.context.length <= 1800);
  assert.match(p.context, /bot chad/);
});

test("auth header", () => {
  assert.deepEqual(wakeAuthHeader("abc\n"), ["Authorization", "Bearer abc"]);
  assert.deepEqual(wakeAuthHeader("Bearer abc"), ["Authorization", "Bearer abc"]);
  assert.deepEqual(wakeAuthHeader("abc", "x-key"), ["x-key", "abc"]);
});

test("hourly cap", () => {
  let h = [];
  for (let i = 0; i < 20; i++) { const r = allowWake(h, 1000 + i); assert.ok(r.allowed); h = r.history; }
  assert.equal(allowWake(h, 2000).allowed, false);
  assert.equal(allowWake(h, 1000 + 3_600_001).allowed, true);
});
