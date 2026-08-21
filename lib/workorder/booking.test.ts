import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bookingCaption, bookingDates, bookingDays, bookingLabel, bookingTone,
  type Booking,
} from "./booking";

const b = (over: Partial<Booking> = {}): Booking =>
  ({ state: "requested", startDate: "2026-08-24", endDate: "2026-08-26", ...over });

describe("a requested booking is not a confirmed one", () => {
  it("says so in words", () => {
    expect(bookingLabel("requested")).toBe("Requested");
    expect(bookingLabel("confirmed")).toBe("Confirmed");
    expect(bookingCaption(b())).toContain("waiting on their answer");
    expect(bookingCaption(b({ state: "confirmed" }))).toBe("Accepted by the contractor");
  });

  it("and in colour — amber while it waits, emerald once agreed", () => {
    expect(bookingTone("requested")).toBe("amber");
    expect(bookingTone("proposed")).toBe("amber");
    expect(bookingTone("confirmed")).toBe("emerald");
  });

  it("is honest when nothing is booked", () => {
    expect(bookingDates(b({ state: "none", startDate: null, endDate: null }))).toBe("No dates yet");
    expect(bookingCaption(b({ state: "none" }))).toBe("Not on anyone's calendar yet");
  });
});

describe("the dates as a person reads them", () => {
  it("shows a span", () => {
    expect(bookingDates(b())).toBe("24 Aug – 26 Aug");
  });

  it("shows a single day as one day, not a span of one", () => {
    expect(bookingDates(b({ endDate: "2026-08-24" }))).toBe("24 Aug");
    expect(bookingDates(b({ endDate: null }))).toBe("24 Aug");
  });

  it("counts the days inclusively", () => {
    expect(bookingDays(b())).toBe(3);                        // Mon, Tue, Wed
    expect(bookingDays(b({ endDate: "2026-08-24" }))).toBe(1);
    expect(bookingDays(b({ endDate: null }))).toBe(1);
  });

  it("does not invent an end date, or a negative span", () => {
    expect(bookingDays(b({ endDate: "2026-08-20" }))).toBe(1);  // end before start
    expect(bookingDays(b({ startDate: null }))).toBe(0);
  });
});

describe("the migration says the same thing the module does", () => {
  it("derives requested/confirmed from the live offer rather than storing it", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20261011000000_wo_booking_dates.sql"), "utf8");
    expect(sql).toContain("when o.state = 'accepted' then 'confirmed'");
    expect(sql).toContain("when o.state = 'offered'  then 'requested'");
    // The work order gains the column it was missing…
    expect(sql).toContain("add column if not exists end_date date");
    // …and the dates land when the job is OFFERED, not when it is accepted.
    expect(sql).toContain("after insert or update of state on public.booking_offers");
    // Releasing the last live offer clears them again.
    expect(sql).toContain("set start_date = null, end_date = null");
  });
});
