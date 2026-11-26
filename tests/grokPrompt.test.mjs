import test from "node:test";
import assert from "node:assert/strict";
import { buildGrokAppPrompt } from "../src/grokPrompt.ts";

test("daily check-in prompt carries the per-bot token and the daily link", () => {
  const prompt = buildGrokAppPrompt("atlas", "Atlas", "Research", "bot-token-abc", "https://office.example");
  assert.equal(prompt.includes("https://office.example/api/ping?b=atlas&daily=1&token=bot-token-abc"), true);
  assert.equal(prompt.includes("orders.instructions"), true);
  assert.equal(prompt.includes("REPORT_SECRET"), false);
  assert.equal(prompt.includes("tok=TOKENS_USED"), true);
  assert.equal(prompt.includes("If a link returns Unauthorized"), true);
});

test("managers get the delegation line, others do not", () => {
  assert.equal(buildGrokAppPrompt("jared", "Jared", "CEO", "t", "https://x", true).includes("orders.team"), true);
  assert.equal(buildGrokAppPrompt("randy", "Randy", "Sales", "t", "https://x", false).includes("orders.team"), false);
});
