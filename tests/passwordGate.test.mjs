import test from "node:test";
import assert from "node:assert/strict";
import { renderOfficePasswordPage } from "../src/passwordGate.ts";

test("a wrong password re-renders the Grok Bot HQ form", () => {
  const html = renderOfficePasswordPage("That password didn't match. Try again.");
  assert.match(html, /Grok Bot HQ/);
  assert.match(html, /Enter your office password to unlock HQ\./);
  assert.match(html, /That password didn't match\. Try again\./);
  assert.match(html, /<label for="office-password"/);
  assert.equal(html.includes("Invalid password"), false);
  assert.equal(html.includes("Grok Bot Office"), false);
});
