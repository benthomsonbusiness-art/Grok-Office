import test from "node:test";
import assert from "node:assert/strict";
import {
  assessGuardrail,
  loadGuardrail,
  payloadTooLargeResponse,
  proxyBlockedResponse,
  proxyUnavailableResponse,
  readCappedBody,
} from "../src/proxyGuard.ts";
import { resolveAlertWebhookUpdate, toPublicSettings } from "../src/publicSettings.ts";

test("guardrail fetch throw refuses the proxy and does not call upstream", async () => {
  let upstreamCalls = 0;
  const assessment = await loadGuardrail(async () => {
    throw new Error("hub down");
  });
  assert.deepEqual(assessment, { action: "unavailable" });
  if (assessment.action !== "forward") {
    const refused = proxyUnavailableResponse();
    assert.equal(refused.status, 503);
    assert.deepEqual(refused.body, { error: "Guardrail unavailable" });
  } else {
    upstreamCalls += 1;
  }
  assert.equal(upstreamCalls, 0);
});

test("blocked guardrail keeps the circuit-breaker response", () => {
  const assessment = assessGuardrail({
    threw: false,
    ok: true,
    parsed: { blocked: true, reason: "Daily cap reached" },
  });
  assert.equal(assessment.action, "block");
  if (assessment.action === "block") {
    const blocked = proxyBlockedResponse(assessment.reason);
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error.message, /Grok Bot HQ Guardrail Circuit-Breaker/);
  }
});

test("a healthy guardrail lets a small body forward", async () => {
  const assessment = await loadGuardrail(async () => {
    return new Response(JSON.stringify({ blocked: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.deepEqual(assessment, { action: "forward" });
  const request = new Request("https://office.example/proxy/ada/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "24" },
    body: JSON.stringify({ model: "grok-4" }),
  });
  const body = await readCappedBody(request);
  assert.equal(body.ok, true);
  if (body.ok) {
    const parsed = JSON.parse(new TextDecoder().decode(body.bytes));
    assert.equal(parsed.model, "grok-4");
  }
});

test("proxy body over 64 KB is rejected before the rest is buffered", async () => {
  const huge = "x".repeat(70_000);
  const request = new Request("https://office.example/proxy/ada/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(huge.length) },
    body: huge,
  });
  const body = await readCappedBody(request);
  assert.equal(body.ok, false);
  const tooLarge = payloadTooLargeResponse();
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(tooLarge.body, { error: "Payload too large (max 64 KB)" });
});

test("snapshot settings hide the webhook URL", () => {
  const pub = toPublicSettings({
    dailyTokenCap: 500000,
    dailyCostCapUsd: 10,
    dailyTaskTarget: 30,
    autoIdleMinutes: 5,
    hardBudgetStop: false,
    alertWebhookUrl: "https://discord.com/api/webhooks/123/secret-token",
  });
  assert.equal(pub.alertWebhookUrl, "");
  assert.equal(pub.alertWebhookConfigured, true);
  assert.equal(JSON.stringify(pub).includes("discord.com"), false);
  assert.equal(JSON.stringify(pub).includes("secret-token"), false);
});

test("blank webhook save keeps the stored URL and clear removes it", () => {
  assert.deepEqual(resolveAlertWebhookUpdate("https://hooks.slack.com/services/T/B/X", {}), { kind: "keep" });
  assert.deepEqual(
    resolveAlertWebhookUpdate("https://hooks.slack.com/services/T/B/X", { alertWebhookUrl: "  " }),
    { kind: "keep" }
  );
  assert.deepEqual(
    resolveAlertWebhookUpdate("https://hooks.slack.com/services/T/B/X", { clearAlertWebhook: true }),
    { kind: "clear" }
  );
});
