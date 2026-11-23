import type { BotStatus, ConnectionLink } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Heartbeat freshness for a bot.
 * fresh: inside the expected window
 * due: past that window, still under twice it
 * stale: late, but seen in the last day
 * offline: silent for a day
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
  const windowMin = expectedIntervalMin > 0 ? expectedIntervalMin : Math.max(1, autoIdleMin || 5);
  const windowMs = windowMin * 60_000;
  if (ageMs <= windowMs) return "fresh";
  if (ageMs <= windowMs * 2) return "due";
  if (ageMs >= DAY_MS) return "offline";
  return "stale";
}
