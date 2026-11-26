import test from "node:test";
import assert from "node:assert/strict";
import { parseQuickCapture, parseAsTask, describeCapture } from "../src/quickCapture.ts";

// Wednesday 2026-11-25 10:00 local
const NOW = new Date(2026, 10, 25, 10, 0, 0);

test("task prefix with tomorrow sets the due date and strips the date word", () => {
  const r = parseQuickCapture("task: call Mike tomorrow", NOW);
  assert.equal(r.kind, "task");
  assert.equal(r.title, "call Mike");
  assert.equal(r.date, "2026-11-26");
});

test("weekday resolves to the next occurrence, never today", () => {
  assert.equal(parseQuickCapture("todo send invoice fri", NOW).date, "2026-11-27");
  assert.equal(parseQuickCapture("todo weekly review wed", NOW).date, "2026-12-02");
});

test("event with weekday and time defaults to one hour", () => {
  const r = parseQuickCapture("event: Dentist fri 2pm", NOW);
  assert.equal(r.kind, "event");
  assert.equal(r.title, "Dentist");
  assert.equal(r.date, "2026-11-27");
  assert.equal(r.startMin, 14 * 60);
  assert.equal(r.durationMin, 60);
});

test("event duration and minutes parse", () => {
  const r = parseQuickCapture("meet Sam tomorrow 9:30am 45m", NOW);
  assert.equal(r.title, "Sam");
  assert.equal(r.startMin, 9 * 60 + 30);
  assert.equal(r.durationMin, 45);
});

test("bare time earlier than now rolls to tomorrow", () => {
  const r = parseQuickCapture("event standup 9am", NOW);
  assert.equal(r.date, "2026-11-26");
});

test("event with no time is all day today", () => {
  const r = parseQuickCapture("event: Launch day", NOW);
  assert.equal(r.date, "2026-11-25");
  assert.equal(r.startMin, null);
  assert.equal(describeCapture(r, NOW), "today · all day");
});

test("@handle dispatches to a bot", () => {
  const r = parseQuickCapture("@atlas research competitors", NOW);
  assert.equal(r.kind, "bot");
  assert.equal(r.botHandle, "atlas");
  assert.equal(r.title, "research competitors");
});

test("plain text is not a capture command, but can be read as a task", () => {
  assert.equal(parseQuickCapture("fleet", NOW), null);
  const t = parseAsTask("pay rent today", NOW);
  assert.equal(t.title, "pay rent");
  assert.equal(t.date, "2026-11-25");
});

test("12am and 12pm convert correctly", () => {
  assert.equal(parseQuickCapture("event a 12pm", NOW).startMin, 12 * 60);
  assert.equal(parseQuickCapture("event b tomorrow 12am", NOW).startMin, 0);
});
