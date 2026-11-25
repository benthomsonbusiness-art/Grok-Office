import test from "node:test";
import assert from "node:assert/strict";
import { roomLabel } from "../src/roomLabel.ts";

test("room labels use one vocabulary", () => {
  assert.equal(roomLabel("working"), "Work");
  assert.equal(roomLabel("waiting"), "Wait");
  assert.equal(roomLabel("error"), "Repair");
  assert.equal(roomLabel("meeting"), "War Room");
  assert.equal(roomLabel("idle"), "Lounge");
  assert.equal(roomLabel("no_report"), "Standby");
});
