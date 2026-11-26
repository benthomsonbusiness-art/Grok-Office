import test from "node:test";
import assert from "node:assert/strict";
import { actionUrl, verifyAction, isValidTopic, normalizeServer, randomTopic } from "../src/notify.ts";

test("signed action links verify, and tampering or expiry fails", async () => {
  const now = Date.UTC(2026, 10, 26);
  const url = new URL(await actionUrl("https://hq.example", "s3cret", "need-1", "approve", now));
  const q = url.searchParams;
  assert.equal(url.pathname, "/api/notify/act");
  assert.equal(await verifyAction("s3cret", q.get("n"), q.get("a"), Number(q.get("exp")), q.get("sig"), now), true);
  assert.equal(await verifyAction("s3cret", q.get("n"), "reject", Number(q.get("exp")), q.get("sig"), now), false);
  assert.equal(await verifyAction("other", q.get("n"), q.get("a"), Number(q.get("exp")), q.get("sig"), now), false);
  assert.equal(await verifyAction("s3cret", q.get("n"), q.get("a"), Number(q.get("exp")), q.get("sig"), now + 8 * 86400000), false);
});

test("topics and servers", () => {
  assert.equal(isValidTopic(randomTopic()), true);
  assert.equal(isValidTopic("short"), false);
  assert.equal(normalizeServer(""), "https://ntfy.sh");
  assert.equal(normalizeServer("https://ntfy.example.com/"), "https://ntfy.example.com");
  assert.equal(normalizeServer("http://ntfy.sh"), null);
});
