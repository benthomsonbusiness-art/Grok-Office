/** Walk speed in office units per second. Frame-rate independent. */
export const WALK_SPEED = 3.4;

const ZONE_COUNTS = {
  working: 8,
  waiting: 5,
  error: 4,
  meeting: 6,
  idle: 8,
  no_report: 5,
};

export function hashId(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Each bot keeps the same desk for a status, including after neighbors finish.
 * A small hash offset keeps overlapping picks from stacking without reshuffling.
 */
export function assignStableSpots(bots) {
  const assigned = new Map();
  for (const bot of bots) {
    const zone = ZONE_COUNTS[bot.status] ? bot.status : "working";
    const n = ZONE_COUNTS[zone];
    const slot = hashId(bot.id) % n;
    const h = hashId(`${bot.id}#nudge`);
    const ang = ((h % 360) * Math.PI) / 180;
    const rad = (h % 3) * 0.38;
    assigned.set(bot.id, {
      zone,
      slot,
      nudgeX: Math.cos(ang) * rad,
      nudgeZ: Math.sin(ang) * rad,
    });
  }
  return assigned;
}

/**
 * Corridor route that skips points already under the bot's feet,
 * so a status change does not send them backward before they cross.
 */
export function buildCorridorPath(from, to, corridorZ = 0.2) {
  const points = [];
  const push = (x, y, z) => {
    const last = points[points.length - 1] || from;
    if (Math.hypot(last.x - x, last.z - z) < 0.45) return;
    points.push({ x, y, z });
  };

  const sameWing =
    Math.sign(from.z - corridorZ) === Math.sign(to.z - corridorZ) &&
    Math.abs(from.z - to.z) < 9 &&
    Math.abs(from.x - to.x) < 12;

  if (!sameWing) {
    if (Math.abs(from.z - corridorZ) > 0.55) push(from.x, from.y, corridorZ);
    if (Math.abs((points[points.length - 1]?.x ?? from.x) - to.x) > 0.55) {
      push(to.x, to.y, corridorZ);
    }
  }
  push(to.x, to.y, to.z);
  return points;
}

export function stepToward(pos, target, dt, speed = WALK_SPEED) {
  const safeDt = Math.max(0, Math.min(dt, 0.05));
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dz = target.z - pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= 0.05 || safeDt === 0) {
    return { x: target.x, y: target.y, z: target.z, arrived: dist <= 0.05, moved: 0 };
  }
  const ease = dist < 0.35 ? 0.65 + 0.35 * (dist / 0.35) : 1;
  const move = Math.min(dist, speed * safeDt * ease);
  return {
    x: pos.x + (dx / dist) * move,
    y: pos.y + dy * Math.min(1, safeDt * 8),
    z: pos.z + (dz / dist) * move,
    arrived: dist - move <= 0.05,
    moved: move,
  };
}

export function dampAngle(current, target, dt) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const safeDt = Math.max(0, Math.min(dt, 0.05));
  return current + diff * Math.min(1, safeDt * 7);
}
