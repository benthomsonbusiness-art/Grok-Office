/**
 * Minimal iCalendar (.ics) reader for Google Calendar "secret address" feeds and
 * other read-only calendar links. Handles line folding, TZID / UTC / floating /
 * all-day times, RRULE (DAILY, WEEKLY, MONTHLY, YEARLY with INTERVAL, COUNT, UNTIL,
 * BYDAY for weekly), EXDATE, and RECURRENCE-ID overrides. Pure, no dependencies.
 */
import type { CalendarEvent } from "./calendar";

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface RawEvent {
  props: Prop[];
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): Prop | null {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0].toUpperCase(), params, value };
}

/** First colon that is not inside a quoted parameter value. */
function findValueColon(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) return i;
  }
  return -1;
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** Offset in ms of `tz` from UTC at the given instant. */
function tzOffsetMs(utcMs: number, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts: Record<string, number> = {};
    for (const p of dtf.formatToParts(new Date(utcMs))) {
      if (p.type !== "literal") parts[p.type] = Number(p.value);
    }
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
    return asUtc - Math.floor(utcMs / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** Wall-clock time in `tz` -> UTC ms. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = tzOffsetMs(guess, tz);
  let utc = guess - off;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off) {
    off = off2;
    utc = guess - off;
  }
  return utc;
}

interface WallTime {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  allDay: boolean;
  utc: boolean;
  tz: string;
}

function parseDateValue(value: string, params: Record<string, string>, defaultTz: string): WallTime | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const allDay = params.VALUE === "DATE" || m[4] === undefined;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: allDay ? 0 : Number(m[4]),
    mi: allDay ? 0 : Number(m[5]),
    s: allDay ? 0 : Number(m[6] ?? 0),
    allDay,
    utc: m[7] === "Z",
    tz: params.TZID || defaultTz,
  };
}

function wallToUtc(w: WallTime): number {
  if (w.utc) return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return zonedToUtc(w.y, w.mo, w.d, w.h, w.mi, w.s, w.tz);
}

function addToWall(w: WallTime, unit: "d" | "m" | "y", n: number): WallTime {
  const base = new Date(Date.UTC(w.y, w.mo - 1, w.d));
  if (unit === "d") base.setUTCDate(base.getUTCDate() + n);
  else if (unit === "m") base.setUTCMonth(base.getUTCMonth() + n);
  else base.setUTCFullYear(base.getUTCFullYear() + n);
  return { ...w, y: base.getUTCFullYear(), mo: base.getUTCMonth() + 1, d: base.getUTCDate() };
}

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function parseDuration(v: string): number {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const ms =
    (Number(m[2] ?? 0) * 7 * 86400 + Number(m[3] ?? 0) * 86400 + Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) *
    1000;
  return sign * ms;
}

export interface IcsOptions {
  calendarName?: string;
  color?: string | null;
  feedId?: string;
  maxEvents?: number;
}

export function parseIcs(text: string, fromMs: number, toMs: number, opts: IcsOptions = {}): CalendarEvent[] {
  const lines = unfold(text);
  let calTz = "UTC";
  let calName = opts.calendarName || "";
  const raw: RawEvent[] = [];
  let cur: RawEvent | null = null;
  let depth = 0;
  for (const line of lines) {
    if (!line) continue;
    if (line === "BEGIN:VEVENT") {
      cur = { props: [] };
      depth = 0;
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) raw.push(cur);
      cur = null;
      continue;
    }
    if (cur) {
      if (line.startsWith("BEGIN:")) depth++;
      else if (line.startsWith("END:")) depth--;
      else if (depth === 0) {
        const p = parseLine(line);
        if (p) cur.props.push(p);
      }
      continue;
    }
    const p = parseLine(line);
    if (p?.name === "X-WR-TIMEZONE" && p.value) calTz = p.value.trim();
    if (p?.name === "X-WR-CALNAME" && p.value && !opts.calendarName) calName = unescapeText(p.value.trim());
  }

  const feedId = opts.feedId || "ics";
  const max = opts.maxEvents ?? 1000;
  const out: CalendarEvent[] = [];
  const overrides = new Set<string>();

  const get = (ev: RawEvent, name: string) => ev.props.find((p) => p.name === name);

  // Collect overridden instances (RECURRENCE-ID) first so expansion can skip them.
  for (const ev of raw) {
    const rid = get(ev, "RECURRENCE-ID");
    const uid = get(ev, "UID")?.value ?? "";
    if (rid && uid) {
      const w = parseDateValue(rid.value, rid.params, calTz);
      if (w) overrides.add(`${uid}|${wallToUtc(w)}`);
    }
  }

  for (const ev of raw) {
    if (out.length >= max) break;
    const status = get(ev, "STATUS")?.value?.toUpperCase();
    if (status === "CANCELLED") continue;
    const dtStartP = get(ev, "DTSTART");
    if (!dtStartP) continue;
    const start = parseDateValue(dtStartP.value, dtStartP.params, calTz);
    if (!start) continue;
    const startMs = wallToUtc(start);
    const dtEndP = get(ev, "DTEND");
    const durP = get(ev, "DURATION");
    let durationMs: number;
    if (dtEndP) {
      const end = parseDateValue(dtEndP.value, dtEndP.params, calTz);
      durationMs = end ? Math.max(0, wallToUtc(end) - startMs) : 0;
    } else if (durP) {
      durationMs = Math.max(0, parseDuration(durP.value.trim()));
    } else {
      durationMs = start.allDay ? 86400000 : 0;
    }
    const uid = get(ev, "UID")?.value?.trim() || `${feedId}-${startMs}`;
    const title = unescapeText(get(ev, "SUMMARY")?.value ?? "").trim() || "(No title)";
    const location = unescapeText(get(ev, "LOCATION")?.value ?? "").trim().slice(0, 200);
    const urlP = get(ev, "URL")?.value?.trim();
    const isOverride = Boolean(get(ev, "RECURRENCE-ID"));

    const exdates = new Set<number>();
    for (const p of ev.props.filter((x) => x.name === "EXDATE")) {
      for (const v of p.value.split(",")) {
        const w = parseDateValue(v, p.params, calTz);
        if (w) exdates.add(wallToUtc(w));
      }
    }

    const emit = (occStartMs: number) => {
      const occEnd = occStartMs + durationMs;
      if (occEnd < fromMs || occStartMs > toMs) return;
      if (out.length >= max) return;
      out.push({
        id: `${feedId}:${uid}:${occStartMs}`.slice(0, 200),
        calendarId: feedId,
        calendarName: calName || "Calendar",
        title: title.slice(0, 200),
        start: new Date(occStartMs).toISOString(),
        end: new Date(occEnd).toISOString(),
        allDay: start.allDay,
        location,
        htmlLink: urlP && /^https:\/\//i.test(urlP) ? urlP : null,
        color: opts.color ?? null,
      });
    };

    const rruleP = get(ev, "RRULE");
    if (!rruleP || isOverride) {
      emit(startMs);
      continue;
    }

    const rule: Record<string, string> = {};
    for (const part of rruleP.value.split(";")) {
      const [k, v] = part.split("=");
      if (k && v) rule[k.toUpperCase()] = v;
    }
    const freq = rule.FREQ;
    const interval = Math.max(1, Number(rule.INTERVAL ?? 1) || 1);
    const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
    let untilMs = Infinity;
    if (rule.UNTIL) {
      const w = parseDateValue(rule.UNTIL, {}, calTz);
      if (w) untilMs = w.allDay ? wallToUtc({ ...w, h: 23, mi: 59, s: 59 }) : wallToUtc(w);
    }
    const byDay = rule.BYDAY
      ? rule.BYDAY.split(",")
          .map((c) => DAY_CODES.indexOf(c.replace(/^[+-]?\d+/, "")))
          .filter((i) => i >= 0)
      : [];

    let produced = 0;
    let guard = 0;
    const consider = (w: WallTime): boolean => {
      const ms = wallToUtc(w);
      if (ms < startMs) return true;
      if (ms > untilMs || produced >= count || ms > toMs) return false;
      produced++;
      if (!exdates.has(ms) && !overrides.has(`${uid}|${ms}`)) emit(ms);
      return true;
    };

    if (freq === "WEEKLY" && byDay.length) {
      // Walk week by week from the week containing DTSTART.
      const startDow = new Date(Date.UTC(start.y, start.mo - 1, start.d)).getUTCDay();
      let weekStart = addToWall(start, "d", -startDow);
      let go = true;
      while (go && guard++ < 2000) {
        for (const dow of [...byDay].sort((a, b) => a - b)) {
          if (!consider(addToWall(weekStart, "d", dow))) {
            go = false;
            break;
          }
        }
        weekStart = addToWall(weekStart, "d", 7 * interval);
      }
    } else if (freq === "DAILY" || freq === "WEEKLY" || freq === "MONTHLY" || freq === "YEARLY") {
      let i = 0;
      while (guard++ < 3000) {
        const w =
          freq === "DAILY"
            ? addToWall(start, "d", i * interval)
            : freq === "WEEKLY"
            ? addToWall(start, "d", i * 7 * interval)
            : freq === "MONTHLY"
            ? addToWall(start, "m", i * interval)
            : addToWall(start, "y", i * interval);
        i++;
        // Skip invalid dates like Feb 30 created by month arithmetic overflow.
        if ((freq === "MONTHLY" || freq === "YEARLY") && w.d !== start.d) continue;
        if (!consider(w)) break;
      }
    } else {
      emit(startMs);
    }
  }

  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Accepts https feed URLs, and turns webcal:// into https://. */
export function normalizeFeedUrl(raw: string): string | null {
  let s = (raw || "").trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, "https://");
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function feedLabel(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "calendar.google.com") {
      const m = u.pathname.match(/\/ical\/([^/]+)\//);
      const id = m ? decodeURIComponent(m[1]) : "";
      if (id.includes("@group.calendar.google.com")) return "Google calendar";
      return id || "Google Calendar";
    }
    return u.hostname;
  } catch {
    return "Calendar";
  }
}
