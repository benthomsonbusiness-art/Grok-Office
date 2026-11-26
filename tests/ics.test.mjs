import test from "node:test";
import assert from "node:assert/strict";
import { parseIcs, zonedToUtc, normalizeFeedUrl, feedLabel } from "../src/ics.ts";

const FROM = Date.UTC(2026, 10, 1);
const TO = Date.UTC(2026, 11, 31);

const ICS = `BEGIN:VCALENDAR\r
X-WR-CALNAME:Ben\r
X-WR-TIMEZONE:America/New_York\r
BEGIN:VEVENT\r
UID:one\r
DTSTART;TZID=America/New_York:20261126T090000\r
DTEND;TZID=America/New_York:20261126T093000\r
SUMMARY:Standup\\, daily\r
LOCATION:Zoom\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:allday\r
DTSTART;VALUE=DATE:20261127\r
DTEND;VALUE=DATE:20261128\r
SUMMARY:Launch\r
 day\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:weekly\r
DTSTART:20261102T150000Z\r
DTEND:20261102T160000Z\r
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5\r
EXDATE:20261104T150000Z\r
SUMMARY:Gym\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:weekly\r
RECURRENCE-ID:20261109T150000Z\r
DTSTART:20261109T170000Z\r
DTEND:20261109T180000Z\r
SUMMARY:Gym (moved)\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:gone\r
STATUS:CANCELLED\r
DTSTART:20261110T150000Z\r
SUMMARY:Cancelled thing\r
END:VEVENT\r
END:VCALENDAR\r
`;

test("timezone-aware event converts to UTC (EST is UTC-5 in November)", () => {
  const ev = parseIcs(ICS, FROM, TO).find((e) => e.title.startsWith("Standup"));
  assert.equal(ev.start, "2026-11-26T14:00:00.000Z");
  assert.equal(ev.end, "2026-11-26T14:30:00.000Z");
  assert.equal(ev.title, "Standup, daily");
  assert.equal(ev.calendarName, "Ben");
});

test("all-day events start at local midnight and unfold long lines", () => {
  const ev = parseIcs(ICS, FROM, TO).find((e) => e.allDay);
  assert.equal(ev.title, "Launchday");
  assert.equal(ev.start, "2026-11-27T05:00:00.000Z");
});

test("weekly BYDAY with COUNT, EXDATE and a moved instance", () => {
  const gym = parseIcs(ICS, FROM, TO).filter((e) => e.title.startsWith("Gym"));
  const starts = gym.map((e) => e.start);
  // COUNT=5 -> Nov 2, 4, 9, 11, 16. Nov 4 excluded, Nov 9 replaced by the override at 17:00.
  assert.deepEqual(starts, [
    "2026-11-02T15:00:00.000Z",
    "2026-11-09T17:00:00.000Z",
    "2026-11-11T15:00:00.000Z",
    "2026-11-16T15:00:00.000Z",
  ]);
});

test("cancelled events are dropped and window filters apply", () => {
  const all = parseIcs(ICS, FROM, TO);
  assert.equal(all.some((e) => e.title === "Cancelled thing"), false);
  assert.equal(parseIcs(ICS, Date.UTC(2027, 0, 1), Date.UTC(2027, 1, 1)).length, 0);
});

test("DST: summer EDT is UTC-4", () => {
  assert.equal(new Date(zonedToUtc(2026, 7, 1, 9, 0, 0, "America/New_York")).toISOString(), "2026-07-01T13:00:00.000Z");
});

test("feed URLs", () => {
  assert.equal(normalizeFeedUrl("webcal://p01-calendars.icloud.com/x.ics"), "https://p01-calendars.icloud.com/x.ics");
  assert.equal(normalizeFeedUrl("http://insecure.example/x.ics"), null);
  assert.equal(
    feedLabel("https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics"),
    "me@gmail.com"
  );
});
