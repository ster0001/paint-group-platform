import { describe, expect, it } from "vitest";
import { dueForReminder, visitDateTime, visitWhen } from "./notify";
import { at } from "./availability";

describe("visit notifications — the pure parts", () => {
  it("phrases the visit in Melbourne time", () => {
    expect(visitWhen(at("2026-09-08", "10:00").toISOString())).toBe("Tue 8 Sep at 10:00 am");
    expect(visitWhen(at("2026-09-08", "14:30").toISOString())).toBe("Tue 8 Sep at 2:30 pm");
    expect(visitDateTime(at("2026-09-08", "10:00").toISOString(), at("2026-09-08", "11:00").toISOString())).toEqual({ date: "2026-09-08", time: "10:00", minutes: 60 });
  });

  it("the evening reminder picks tomorrow's booked, un-reminded visits with a mobile", () => {
    const now = at("2026-09-07", "18:00");
    const v = (over: Partial<Parameters<typeof dueForReminder>[0][number]>) => ({
      id: "x", starts_at: at("2026-09-08", "10:00").toISOString(), status: "booked" as const, reminder_sent_at: null, customer_phone: "0400 000 000", ...over,
    });
    const due = dueForReminder([
      v({ id: "tomorrow" }),
      v({ id: "today", starts_at: at("2026-09-07", "19:00").toISOString() }),
      v({ id: "later", starts_at: at("2026-09-09", "10:00").toISOString() }),
      v({ id: "reminded", reminder_sent_at: "2026-09-06T08:00:00Z" }),
      v({ id: "no-phone", customer_phone: null }),
      v({ id: "cancelled", status: "cancelled" }),
    ], now);
    expect(due.map((d) => d.id)).toEqual(["tomorrow"]);
  });
});
