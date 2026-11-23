import test from "node:test";
import assert from "node:assert/strict";
import { isSafeCallbackUrl } from "../src/security.ts";

test("isSafeCallbackUrl allows public HTTPS webhook URLs", () => {
  assert.equal(isSafeCallbackUrl("https://discord.com/api/webhooks/123/abc"), true);
  assert.equal(isSafeCallbackUrl("https://hooks.slack.com/services/T00/B00/XXX"), true);
});

test("isSafeCallbackUrl blocks non-HTTPS, credentials, and private IPv4/IPv6 ranges", () => {
  const blocked = [
    "http://discord.com/webhook",
    "javascript:alert(1)",
    "https://user:pass@discord.com/webhook",
    "https://localhost/admin",
    "https://api.localhost/admin",
    "https://127.0.0.1/secret",
    "https://10.0.0.1/internal",
    "https://100.64.0.1/cgnat",
    "https://169.254.169.254/latest/meta-data",
    "https://172.16.0.1/private",
    "https://192.168.1.1/router",
    "https://[::1]/loopback",
    "https://[::ffff:127.0.0.1]/mapped",
    "https://[::ffff:7f00:1]/mapped-hex",
    "https://[fc00::1]/ula",
    "https://[fe80::1]/link-local",
    "https://2130706433/decimal-loopback",
  ];
  for (const url of blocked) {
    assert.equal(isSafeCallbackUrl(url), false, `Expected blocked: ${url}`);
  }
});
