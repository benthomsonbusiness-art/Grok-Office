import test from "node:test";
import assert from "node:assert/strict";
import { redactAlertWebhook } from "../src/settingsRedact.ts";

test("public settings hide the webhook URL and report that one is saved", () => {
  const stored = "https://discord.com/api/webhooks/123/super-secret-token";
  const out = redactAlertWebhook({
    dailyTokenCap: 500000,
    alertWebhookUrl: stored,
  });
  assert.equal(out.alertWebhookUrl, "");
  assert.equal(out.alertWebhookConfigured, true);
  assert.equal(out.dailyTokenCap, 500000);
  const json = JSON.stringify(out);
  assert.equal(json.includes("discord.com"), false);
  assert.equal(json.includes("super-secret-token"), false);
});

test("an empty webhook is not marked configured", () => {
  const out = redactAlertWebhook({ alertWebhookUrl: "   " });
  assert.equal(out.alertWebhookConfigured, false);
  assert.equal(out.alertWebhookUrl, "");
});
