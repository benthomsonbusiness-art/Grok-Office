import test from "node:test";
import assert from "node:assert/strict";
import { officePasswordGateHtml } from "../src/passwordGate.ts";

test("a wrong password re-renders the HQ gate with a labeled error", () => {
  const html = officePasswordGateHtml(true);
  assert.equal(html.includes("Grok Bot HQ"), true);
  assert.equal(html.includes("Enter your office password to unlock HQ."), true);
  assert.equal(html.includes("That password didn't match. Try again."), true);
  assert.equal(html.includes('<label for="office-password">'), true);
  assert.equal(html.includes('id="office-password"'), true);
  assert.equal(html.includes("Invalid password"), false);
  assert.equal(html.includes("Grok Bot Office"), false);
});

test("the first gate render has no error sentence", () => {
  const html = officePasswordGateHtml(false);
  assert.equal(html.includes("Grok Bot HQ"), true);
  assert.equal(html.includes("That password didn't match. Try again."), false);
  assert.equal(html.includes('<label for="office-password">'), true);
});
