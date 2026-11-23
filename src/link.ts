import type { BotStatus, ConnectionLink } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Heartbeat freshness for a bot.
 * fresh: inside the expected active/check-in window
 * standby: on-demand bot (no schedule SLA) idling calmly within the last 24h
 * due: scheduled bot past its interval, still under twice it
 * stale: scheduled bot late (> 2x interval), seen within the last day
 * offline: silent for >= 24 hours
 * waiting: no check-in timestamp yet
 */
export function connectionLink(
  lastSeenAt: string | null | undefined,
  expectedIntervalMin: number,
  autoIdleMin: number,
  nowMs: number,
  _status?: BotStatus
): ConnectionLink {
  if (!lastSeenAt) return "waiting";
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen)) return "waiting";
  const ageMs = Math.max(0, nowMs - seen);

  if (expectedIntervalMin <= 0) {
    const idleWindowMs = Math.max(1, autoIdleMin || 5) * 60_000;
    if (ageMs <= idleWindowMs) return "fresh";
    if (ageMs >= DAY_MS) return "offline";
    return "standby";
  }

  const windowMs = expectedIntervalMin * 60_000;
  if (ageMs <= windowMs) return "fresh";
  if (ageMs <= windowMs * 2) return "due";
  if (ageMs >= DAY_MS) return "offline";
  return "stale";
}
