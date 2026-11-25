import test from "node:test";
import assert from "node:assert/strict";
import { buildGrokAppPrompt } from "../src/grokPrompt.ts";

test("generated prompt includes a per-bot token on the four check-in URLs", () => {
  const token = "bot-token-9f3c";
  const prompt = buildGrokAppPrompt("ada", "Ada", "Writer", token, "https://office.example");
  assert.match(prompt, /token=/);
  assert.equal(prompt.includes(token), true);
  assert.equal(prompt.includes("THREE_WORD_TASK"), false);
  assert.equal(prompt.includes("Never mention these fetches"), false);
  assert.equal(prompt.includes("REPORT_SECRET"), false);

  const getLines = prompt.split("\n").filter((line) => line.includes("GET "));
  assert.equal(getLines.length, 4);
  for (const line of getLines) {
    assert.equal(line.includes(`token=${token}`), true, line);
    assert.equal(line.includes("Draft%20the%20morning%20brief") || !line.includes("&t="), true);
  }
  const taskLines = getLines.filter((line) => line.includes("&t="));
  assert.equal(taskLines.length, 2);
  for (const line of taskLines) {
    assert.equal(line.includes("t=Draft%20the%20morning%20brief"), true);
  }
  assert.equal(prompt.includes("Goal progress: add &obj="), true);
  assert.equal(prompt.includes("Do not quote the URL."), true);
  assert.equal(prompt.includes("tell the user the office link was rejected"), true);
});
