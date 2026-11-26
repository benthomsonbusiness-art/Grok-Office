import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAgentKind, supportsPush, maskDispatchUrl, buildDispatchPayload } from "../src/agentKinds.ts";

test("unknown kinds fall back to grok", () => {
  assert.equal(normalizeAgentKind("n8n"), "n8n");
  assert.equal(normalizeAgentKind("bogus"), "grok");
  assert.equal(normalizeAgentKind(undefined), "grok");
});

test("only webhook-style agents receive pushes", () => {
  assert.equal(supportsPush("n8n"), true);
  assert.equal(supportsPush("webhook"), true);
  assert.equal(supportsPush("grok"), false);
});

test("dispatch URLs are masked for display", () => {
  assert.equal(maskDispatchUrl("https://n8n.example.com/webhook/secret-id?x=1"), "https://n8n.example.com/…");
  assert.equal(maskDispatchUrl(""), "");
});

test("dispatch payload carries encoded report links", () => {
  const p = buildDispatchPayload("https://hq.example", "my bot", "tok", "Do X", "q1", "2026-11-25T00:00:00Z");
  assert.equal(p.event, "task.dispatched");
  assert.equal(p.doneUrl, "https://hq.example/api/ping?b=my%20bot&done=1&t=Do%20X&token=tok");
});
