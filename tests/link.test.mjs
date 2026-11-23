import assert from "node:assert/strict";
import test from "node:test";
import { connectionLink } from "../src/link.ts";

const now = Date.parse("2026-11-23T03:00:00.000Z");

test("a check-in inside the idle window is fresh", () => {
  const seen = new Date(now - 2 * 60_000).toISOString();
  assert.equal(connectionLink(seen, 0, 5, now), "fresh");
});

test("an on-demand bot past the idle window rests in standby, then offline after 24h", () => {
  assert.equal(connectionLink(new Date(now - 45 * 60_000).toISOString(), 0, 5, now), "standby");
  assert.equal(connectionLink(new Date(now - 25 * 60 * 60_000).toISOString(), 0, 5, now), "offline");
});

test("a scheduled bot past its interval is due, then stale, then offline", () => {
  assert.equal(connectionLink(new Date(now - 20 * 60_000).toISOString(), 15, 5, now), "due");
  assert.equal(connectionLink(new Date(now - 40 * 60_000).toISOString(), 15, 5, now), "stale");
  assert.equal(connectionLink(new Date(now - 25 * 60 * 60_000).toISOString(), 15, 5, now), "offline");
});

test("a missing timestamp is waiting", () => {
  assert.equal(connectionLink("", 15, 5, now), "waiting");
  assert.equal(connectionLink(null, 0, 5, now), "waiting");
});
