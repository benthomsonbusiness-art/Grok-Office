/**
 * Google Calendar bridge helpers. The bridge is a private Google Apps Script web app
 * (same zero-OAuth pattern as the Google Tasks bridge) that lists and creates events.
 */

export interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  htmlLink: string | null;
  color: string | null;
}

export interface CalendarSyncState {
  connected: boolean;
  canCreate?: boolean;
  bridgeConnected?: boolean;
  feeds?: Array<{ id: string; name: string; color: string; host: string }>;
  lastSyncAt: string | null;
  error: string | null;
  eventCount: number;
}

export function isValidAppsScriptUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return (
      u.protocol === "https:" &&
      u.hostname.toLowerCase() === "script.google.com" &&
      u.pathname.startsWith("/macros/") &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function isoOrNull(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function safeLink(v: unknown): string | null {
  const s = str(v, 600);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Validate and normalize one raw event from the bridge. Returns null when unusable. */
export function normalizeBridgeEvent(raw: unknown): CalendarEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 200);
  const title = str(r.title, 200) || "(No title)";
  const start = isoOrNull(r.start);
  let end = isoOrNull(r.end);
  if (!id || !start) return null;
  if (!end || Date.parse(end) < Date.parse(start)) end = start;
  const color = str(r.color, 16);
  return {
    id,
    calendarId: str(r.calendarId, 200) || "primary",
    calendarName: str(r.calendarName, 100) || "Calendar",
    title,
    start,
    end,
    allDay: r.allDay === true,
    location: str(r.location, 200),
    htmlLink: safeLink(r.htmlLink),
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : null,
  };
}

export interface NewEventInput {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
}

/** Validate a create-event request from the dashboard. */
export function parseNewEvent(body: unknown): NewEventInput | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid JSON" };
  const b = body as Record<string, unknown>;
  const title = str(b.title, 200);
  if (!title) return { error: "Event title is required" };
  const allDay = b.allDay === true;
  const start = isoOrNull(b.start);
  if (!start) return { error: "A valid start time is required" };
  let end = isoOrNull(b.end);
  if (!end) {
    end = new Date(Date.parse(start) + (allDay ? 24 * 60 : 60) * 60_000).toISOString();
  }
  if (Date.parse(end) <= Date.parse(start)) return { error: "End must be after start" };
  if (Date.parse(end) - Date.parse(start) > 14 * 24 * 60 * 60_000) {
    return { error: "Events longer than 14 days are not supported" };
  }
  return { title, start, end, allDay, description: str(b.description, 1000) || undefined };
}
