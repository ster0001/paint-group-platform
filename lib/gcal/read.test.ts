import { test, expect } from "vitest";
import { busyFromEvents, calendarsToRead } from "./read";

// The pure half of reading a staff member's own Google calendars (8 Sep).

test("calendarsToRead: ticked calendars only, never the app's own", () => {
  const list = [
    { id: "primary-id", summary: "info@paintgroup.com.au", primary: true, selected: true },
    { id: "shared", summary: "Team leave", selected: true },
    { id: "unticked", summary: "Birthdays", selected: false },
    { id: "hidden", summary: "Old", hidden: true, selected: true },
    { id: "app-cal", summary: "Paint Group Visits", selected: true },
    { id: "jobs-cal", summary: "Paint Group Jobs", selected: true },
  ];
  expect(calendarsToRead(list, "app-cal").map((c) => c.id)).toEqual(["primary-id", "shared"]);
  // The app calendar is excluded by id even if someone renamed it.
  expect(calendarsToRead([{ id: "app-cal", summary: "Renamed", selected: true }], "app-cal")).toEqual([]);
});

test("busyFromEvents: Google's own free/busy rule", () => {
  const busy = busyFromEvents("s1", "info@", [
    { id: "a", summary: "Dentist", start: { dateTime: "2026-09-08T10:00:00+10:00" }, end: { dateTime: "2026-09-08T11:00:00+10:00" } },
    { id: "b", summary: "Reminder", transparency: "transparent", start: { dateTime: "2026-09-08T12:00:00+10:00" }, end: { dateTime: "2026-09-08T12:30:00+10:00" } },
    { id: "c", summary: "Gone", status: "cancelled", start: { dateTime: "2026-09-08T13:00:00+10:00" }, end: { dateTime: "2026-09-08T14:00:00+10:00" } },
    { id: "d", summary: "Declined", attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: "2026-09-08T15:00:00+10:00" }, end: { dateTime: "2026-09-08T16:00:00+10:00" } },
    { id: "e", summary: "Office", eventType: "workingLocation", start: { dateTime: "2026-09-08T09:00:00+10:00" }, end: { dateTime: "2026-09-08T17:00:00+10:00" } },
    { id: "f", summary: "", start: { dateTime: "2026-09-08T08:00:00+10:00" }, end: { dateTime: "2026-09-08T08:30:00+10:00" } },
    { id: "g", summary: "Leave", start: { date: "2026-09-10" }, end: { date: "2026-09-12" } },
    { id: "h", summary: "Broken", start: { dateTime: "2026-09-08T10:00:00+10:00" }, end: { dateTime: "2026-09-08T09:00:00+10:00" } },
  ]);
  expect(busy.map((b) => b.label)).toEqual(["Busy", "Dentist", "Leave"]);
  const dentist = busy[1];
  expect(dentist.startsAt).toBe("2026-09-08T00:00:00.000Z");
  expect(dentist.endsAt).toBe("2026-09-08T01:00:00.000Z");
  expect(dentist.calendar).toBe("info@");
  expect(dentist.allDay).toBe(false);
  // All-day leave: Melbourne midnight (AEST, +10) to the exclusive end date.
  const leave = busy[2];
  expect(leave.allDay).toBe(true);
  expect(leave.startsAt).toBe("2026-09-09T14:00:00.000Z");
  expect(leave.endsAt).toBe("2026-09-11T14:00:00.000Z");
});
