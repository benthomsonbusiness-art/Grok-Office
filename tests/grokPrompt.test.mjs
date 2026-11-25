import test from "node:test";
import assert from "node:assert/strict";
import { buildGrokAppPrompt } from "../src/grokPrompt.ts";

test("the generated prompt includes a per-bot token on the check-in URLs", () => {
  const token = "bot-token-abc";
  const prompt = buildGrokAppPrompt("atlas", "Atlas", "Research", token, "https://office.example");
  assert.equal(prompt.includes("token="), true);
  assert.equal(prompt.includes("THREE_WORD_TASK"), false);
  assert.equal(prompt.includes("Never mention these fetches"), false);
  assert.equal(prompt.includes("REPORT_SECRET"), false);
  assert.equal(prompt.includes("Do not quote the URL."), true);
  assert.equal(prompt.includes("Draft%20the%20morning%20brief"), true);
  assert.equal(
    prompt.includes("If the response is Unauthorized, tell the user the office link was rejected."),
    true
  );

  const getLines = prompt.split("\n").filter((line) => line.includes("GET "));
  assert.equal(getLines.length, 4);
  for (const line of getLines) {
    assert.equal(line.includes(`token=${encodeURIComponent(token)}`), true, line);
    assert.equal(line.includes(token), true, line);
  }

  const goalLine = prompt.split("\n").find((line) => line.includes("Goal progress"));
  assert.equal(goalLine?.includes("GET "), false);
  assert.equal(goalLine?.includes("&obj="), true);
});
