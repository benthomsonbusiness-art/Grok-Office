/**
 * Recurring routines: schedule parsing and next-run calculation in the owner's time zone.
 *
 * Schedule text (what agents and the dashboard send):
 *   "daily 07:00"            every day
 *   "weekdays 07:00"         Mon-Fri
 *   "weekends 10:00"         Sat-Sun
 *   "mon,wed,fri 09:30"      specific days (also "weekly fri 16:00", "every monday 9am")
 *   "monthly 1 08:00"        day of month (1-28, or "last")
 *   "hourly"                 every hour on the hour
 */

/** Wall-clock time in `tz` -> UTC ms (self-contained so node tests can import this file). */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, sec: number, tz: string): number {
  const offset = (utcMs: number): number => {
    const p: Record<string, number> = {};
    for (const part of new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(utcMs))) {
      if (part.type !== "literal") p[part.type] = Number(part.value);
    }
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
  };
  const guess = Date.UTC(y, mo - 1, d, h, mi, sec);
  let utc = guess - offset(guess);
  const off2 = offset(utc);
  if (guess - off2 !== utc) utc = guess - off2;
  return utc;
}

export type ScheduleKind = "daily" | "weekly" | "monthly" | "hourly";

export interface Schedule {
  kind: ScheduleKind;
  /** 0=Sun..6=Sat, used by weekly. */
  days: number[];
  /** Day of month for monthly; 0 means last day. */
  monthDay: number;
  hour: number;
  minute: number;
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseTime(text: string): { hour: number; minute: number } | null {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (minute > 59) return null;
  if (ap) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = ap === "am" ? 0 : 12;
    else if (ap === "pm") hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

export function parseSchedule(raw: string): Schedule | null {
  const text = (raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;
  if (/^(hourly|every hour)$/.test(text)) return { kind: "hourly", days: [], monthDay: 1, hour: 0, minute: 0 };

  // Pull the time from the end, e.g. "... 7:30am", "... 07:00", "... at 9".
  const timeMatch = text.match(/(?:\s|^)(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i);
  const time = timeMatch ? parseTime(timeMatch[1]) : { hour: 9, minute: 0 };
  if (!time) return null;
  const head = (timeMatch ? text.slice(0, timeMatch.index).trim() : text).replace(/^every\s+/, "");

  if (head === "daily" || head === "day" || head === "every day" || head === "") {
    return { kind: "daily", days: [], monthDay: 1, ...time };
  }
  if (head === "weekdays" || head === "weekday") return { kind: "weekly", days: [1, 2, 3, 4, 5], monthDay: 1, ...time };
  if (head === "weekends" || head === "weekend") return { kind: "weekly", days: [0, 6], monthDay: 1, ...time };

  const monthly = head.match(/^monthly(?:\s+(?:on\s+)?(?:the\s+)?(last|\d{1,2})(?:st|nd|rd|th)?)?$/);
  if (monthly) {
    const d = monthly[1] === "last" ? 0 : Number(monthly[1] ?? 1);
    if (d < 0 || d > 28) return null;
    return { kind: "monthly", days: [], monthDay: d, ...time };
  }

  const dayPart = head.replace(/^weekly\s*(on\s+)?/, "").replace(/\band\b/g, ",");
  const days = new Set<number>();
  for (const token of dayPart.split(/[,\s/]+/).filter(Boolean)) {
    const idx = DAY_NAMES.indexOf(token.slice(0, 3));
    if (idx < 0) return null;
    days.add(idx);
  }
  if (days.size === 0) {
    if (head === "weekly") return { kind: "weekly", days: [1], monthDay: 1, ...time };
    return null;
  }
  return { kind: "weekly", days: [...days].sort((a, b) => a - b), monthDay: 1, ...time };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function describeSchedule(s: Schedule): string {
  if (s.kind === "hourly") return "Every hour";
  const h12 = s.hour % 12 === 0 ? 12 : s.hour % 12;
  const time = `${h12}${s.minute ? `:${pad(s.minute)}` : ""}${s.hour < 12 ? "am" : "pm"}`;
  if (s.kind === "daily") return `Every day at ${time}`;
  if (s.kind === "monthly") return `Monthly on the ${s.monthDay === 0 ? "last day" : ordinal(s.monthDay)} at ${time}`;
  const key = s.days.join(",");
  if (key === "1,2,3,4,5") return `Weekdays at ${time}`;
  if (key === "0,6") return `Weekends at ${time}`;
  const names = s.days.map((d) => DAY_NAMES[d][0].toUpperCase() + DAY_NAMES[d].slice(1));
  return `${names.join(", ")} at ${time}`;
}

/** Canonical text form, stored in the database. */
export function scheduleToText(s: Schedule): string {
  const t = `${pad(s.hour)}:${pad(s.minute)}`;
  if (s.kind === "hourly") return "hourly";
  if (s.kind === "daily") return `daily ${t}`;
  if (s.kind === "monthly") return `monthly ${s.monthDay === 0 ? "last" : s.monthDay} ${t}`;
  const key = s.days.join(",");
  if (key === "1,2,3,4,5") return `weekdays ${t}`;
  if (key === "0,6") return `weekends ${t}`;
  return `${s.days.map((d) => DAY_NAMES[d]).join(",")} ${t}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Local calendar date parts of a UTC instant in a time zone. */
function localParts(ms: number, tz: string): { y: number; mo: number; d: number; dow: number; h: number; mi: number } {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(ms))) {
    parts[p.type] = p.value;
  }
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    dow: DAY_NAMES.indexOf(parts.weekday.toLowerCase().slice(0, 3)),
    h: Number(parts.hour) % 24,
    mi: Number(parts.minute),
  };
}

function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** First run strictly after `afterMs`, in UTC ms. */
export function nextRunAfter(s: Schedule, afterMs: number, tz: string): number {
  if (s.kind === "hourly") {
    return Math.floor(afterMs / 3_600_000) * 3_600_000 + 3_600_000;
  }
  const start = localParts(afterMs, tz);
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + i));
    const y = day.getUTCFullYear();
    const mo = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const dow = day.getUTCDay();
    let match = false;
    if (s.kind === "daily") match = true;
    else if (s.kind === "weekly") match = s.days.includes(dow);
    else if (s.kind === "monthly") match = d === (s.monthDay === 0 ? daysInMonth(y, mo) : s.monthDay);
    if (!match) continue;
    const runMs = zonedToUtc(y, mo, d, s.hour, s.minute, 0, tz);
    if (runMs > afterMs) return runMs;
  }
  return afterMs + 24 * 3_600_000;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export { localParts };
