import test from "node:test";
import assert from "node:assert/strict";
import { parseSchedule, nextRunAfter, describeSchedule, scheduleToText } from "../src/routines.ts";

const NY = "America/New_York";
// Wednesday 2026-11-25 15:00 UTC = 10:00 New York
const NOW = Date.UTC(2026, 10, 25, 15, 0);

test("parses the common schedule forms", () => {
  assert.deepEqual(parseSchedule("weekdays 07:00"), { kind: "weekly", days: [1, 2, 3, 4, 5], monthDay: 1, hour: 7, minute: 0 });
  assert.equal(parseSchedule("daily 6:30pm").hour, 18);
  assert.deepEqual(parseSchedule("mon,wed,fri 09:30").days, [1, 3, 5]);
  assert.deepEqual(parseSchedule("every monday 9am").days, [1]);
  assert.deepEqual(parseSchedule("weekly fri 16:00").days, [5]);
  assert.equal(parseSchedule("monthly 1 08:00").monthDay, 1);
  assert.equal(parseSchedule("monthly last 17:00").monthDay, 0);
  assert.equal(parseSchedule("hourly").kind, "hourly");
  assert.equal(parseSchedule("whenever"), null);
  assert.equal(parseSchedule("daily 25:00"), null);
});

test("next run respects the owner's time zone", () => {
  const s = parseSchedule("daily 07:00");
  // 10:00 NY now, so next 07:00 NY is tomorrow = 12:00 UTC (EST, UTC-5)
  assert.equal(new Date(nextRunAfter(s, NOW, NY)).toISOString(), "2026-11-26T12:00:00.000Z");
  const later = parseSchedule("daily 18:00");
  assert.equal(new Date(nextRunAfter(later, NOW, NY)).toISOString(), "2026-11-25T23:00:00.000Z");
});

test("weekdays skip the weekend", () => {
  const s = parseSchedule("weekdays 07:00");
  const fri = Date.UTC(2026, 10, 27, 15, 0); // Friday 10am NY
  assert.equal(new Date(nextRunAfter(s, fri, NY)).toISOString(), "2026-11-30T12:00:00.000Z"); // Monday
});

test("monthly last day and day-of-month", () => {
  assert.equal(new Date(nextRunAfter(parseSchedule("monthly last 09:00"), NOW, NY)).toISOString(), "2026-11-30T14:00:00.000Z");
  assert.equal(new Date(nextRunAfter(parseSchedule("monthly 1 08:00"), NOW, NY)).toISOString(), "2026-12-01T13:00:00.000Z");
});

test("describe and canonical text", () => {
  assert.equal(describeSchedule(parseSchedule("weekdays 7am")), "Weekdays at 7am");
  assert.equal(describeSchedule(parseSchedule("tue,thu 14:30")), "Tue, Thu at 2:30pm");
  assert.equal(scheduleToText(parseSchedule("every monday 9am")), "mon 09:00");
});
