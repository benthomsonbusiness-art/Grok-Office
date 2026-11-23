import assert from "node:assert/strict";
import test from "node:test";
import {
  WALK_SPEED,
  assignStableSpots,
  buildCorridorPath,
  stepToward,
} from "../src/client/botMotion.mjs";

function fleet(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `bot-${String(i).padStart(2, "0")}`,
    status: i % 4 === 0 ? "idle" : i % 4 === 1 ? "meeting" : "working",
  }));
}

test("spot assignment is stable when other bots finish", () => {
  const bots = fleet(36);
  const before = assignStableSpots(bots);
  const afterFinish = bots.map((bot) =>
    bot.status === "working" && Number(bot.id.slice(-2)) % 2 === 0
      ? { ...bot, status: "idle" }
      : bot
  );
  const after = assignStableSpots(afterFinish);
  for (const bot of bots) {
    const stayed = afterFinish.find((b) => b.id === bot.id);
    if (stayed.status !== bot.status) continue;
    assert.deepEqual(after.get(bot.id), before.get(bot.id), bot.id);
  }
  assert.deepEqual(assignStableSpots(bots), before);
});

test("a 48-bot check-off wave does not move bots that are still working", () => {
  const bots = fleet(48);
  const before = assignStableSpots(bots);
  const doneIds = new Set(
    bots.filter((b) => b.status === "working").slice(0, 16).map((b) => b.id)
  );
  const after = assignStableSpots(
    bots.map((b) => (doneIds.has(b.id) ? { ...b, status: "idle" } : b))
  );
  for (const bot of bots) {
    if (doneIds.has(bot.id)) {
      assert.equal(after.get(bot.id).zone, "idle");
      continue;
    }
    assert.deepEqual(after.get(bot.id), before.get(bot.id));
  }
});

test("corridor path heads toward the hall instead of stepping backward", () => {
  const from = { x: -14, y: 0.04, z: -6 };
  const to = { x: 1.2, y: 0.04, z: 8.4 };
  const path = buildCorridorPath(from, to);
  assert.ok(path.length >= 2);
  assert.ok(path[0].z > from.z, "first step should move toward the corridor");
  const end = path[path.length - 1];
  assert.equal(end.x, to.x);
  assert.equal(end.z, to.z);
  for (let i = 0; i < path.length; i++) {
    const prev = i === 0 ? from : path[i - 1];
    assert.ok(Math.hypot(path[i].x - prev.x, path[i].z - prev.z) >= 0.45);
  }
});

test("jittery frames stay on the path and never overshoot", () => {
  let pos = { x: -17, y: 0.04, z: -10 };
  const target = { x: 4, y: 0.04, z: 9 };
  const frames = [0.004, 0.016, 0.033, 0.05, 0.008, 0.1, 0.002];
  let guard = 0;
  let prevDist = Math.hypot(target.x - pos.x, target.z - pos.z);
  while (guard < 4000) {
    const dt = frames[guard % frames.length];
    const next = stepToward(pos, target, dt);
    const applied = Math.min(Math.max(dt, 0), 0.05);
    assert.ok(next.moved <= WALK_SPEED * applied + 1e-6);
    const dist = Math.hypot(target.x - next.x, target.z - next.z);
    assert.ok(dist <= prevDist + 1e-6);
    prevDist = dist;
    pos = next;
    guard += 1;
    if (next.arrived) break;
  }
  assert.ok(guard < 4000);
  assert.ok(Math.hypot(target.x - pos.x, target.z - pos.z) < 0.06);
});
