import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBridgeEvent, parseNewEvent, isValidAppsScriptUrl } from "../src/calendar.ts";

test("only script.google.com macro URLs are accepted", () => {
  assert.equal(isValidAppsScriptUrl("https://script.google.com/macros/s/abc/exec"), true);
  assert.equal(isValidAppsScriptUrl("http://script.google.com/macros/s/abc/exec"), false);
  assert.equal(isValidAppsScriptUrl("https://evil.example/macros/s/abc/exec"), false);
  assert.equal(isValidAppsScriptUrl("https://script.google.com/home"), false);
});

test("bridge events normalize and reject bad rows", () => {
  const ev = normalizeBridgeEvent({
    id: "e1",
    title: "Standup",
    start: "2026-11-25T15:00:00Z",
    end: "2026-11-25T15:30:00Z",
    htmlLink: "javascript:alert(1)",
    color: "#ff0000",
  });
  assert.equal(ev.title, "Standup");
  assert.equal(ev.htmlLink, null);
  assert.equal(ev.color, "#ff0000");
  assert.equal(normalizeBridgeEvent({ id: "x" }), null);
  assert.equal(normalizeBridgeEvent(null), null);
});

test("end before start is clamped to start", () => {
  const ev = normalizeBridgeEvent({ id: "e", start: "2026-11-25T15:00:00Z", end: "2026-11-25T14:00:00Z" });
  assert.equal(ev.end, ev.start);
});

test("new event validation", () => {
  assert.deepEqual(parseNewEvent({}), { error: "Event title is required" });
  const ok = parseNewEvent({ title: "Call", start: "2026-11-25T15:00:00Z" });
  assert.equal(ok.end, "2026-11-25T16:00:00.000Z");
  assert.equal(
    parseNewEvent({ title: "x", start: "2026-11-25T15:00:00Z", end: "2026-11-25T14:00:00Z" }).error,
    "End must be after start"
  );
});
