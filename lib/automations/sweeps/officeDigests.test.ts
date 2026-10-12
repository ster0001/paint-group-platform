import { describe, expect, it } from "vitest";
import { melbourneInstant } from "@/lib/time/businessHours";
import { followupEmail, followupSentDates, inHours, prestartIncomplete, prestartSubject, prestartWindows } from "./officeDigests";

/** Tom, 12 Oct 2026: the follow-ups email and the 14:00 pre-start texts. Oct 2026: Mon 12 … Fri 16. */
const at = (d: number, h = 9, m = 10) => melbourneInstant(2026, m, d, h);
const none = new Set<string>();

describe("followupSentDates — Monday to Friday, three days after sending", () => {
  it("Tuesday to Friday: the day three days back", () => {
    expect(followupSentDates(at(13))).toEqual(["2026-10-10"]);   // Tue ← Sat
    expect(followupSentDates(at(16))).toEqual(["2026-10-13"]);   // Fri ← Tue
  });
  it("Monday also catches the weekend's marks, so a Wednesday or Thursday send is never skipped", () => {
    expect(followupSentDates(at(12))).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
  });
  it("no email on Saturday or Sunday", () => {
    expect(followupSentDates(at(17))).toBeNull();
    expect(followupSentDates(at(18))).toBeNull();
  });
  it("counts Melbourne's calendar, not UTC — 7am Melbourne is still yesterday in UTC", () => {
    expect(followupSentDates(at(14, 7))).toEqual(["2026-10-11"]);
  });
});

describe("prestartWindows — business days, Monday to Friday", () => {
  it("Thursday: final = Friday starts; first = Monday starts (next week)", () => {
    expect(prestartWindows(at(15, 14), none)).toEqual([
      { which: "final", after: "2026-10-15", through: "2026-10-16" },
      { which: "two_days", after: "2026-10-16", through: "2026-10-19" },
    ]);
  });
  it("Friday: the final covers Saturday, Sunday and Monday starts; the first covers Tuesday", () => {
    expect(prestartWindows(at(16, 14), none)).toEqual([
      { which: "final", after: "2026-10-16", through: "2026-10-19" },
      { which: "two_days", after: "2026-10-19", through: "2026-10-20" },
    ]);
  });
  it("a public holiday is not a business day", () => {
    const cup = new Set(["2026-11-03"]);   // Melbourne Cup, Tuesday
    expect(prestartWindows(melbourneInstant(2026, 11, 2, 14), cup)?.[0].through).toBe("2026-11-04");
    expect(prestartWindows(melbourneInstant(2026, 11, 3, 14), cup)).toBeNull();
  });
  it("nothing on the weekend", () => {
    expect(prestartWindows(at(17, 14), none)).toBeNull();
  });
});

describe("the hours and the words", () => {
  it("14:00 window, Melbourne time", () => {
    expect(inHours(at(15, 13), { from: 14, until: 17 })).toBe(false);
    expect(inHours(at(15, 14), { from: 14, until: 17 })).toBe(true);
    expect(inHours(at(15, 17), { from: 14, until: 17 })).toBe(false);
  });
  it("not filled out = no list, or a required tick still open", () => {
    expect(prestartIncomplete([])).toBe(true);
    expect(prestartIncomplete([{ required: true, done_at: null }, { required: true, done_at: "x" }])).toBe(true);
    expect(prestartIncomplete([{ required: false, done_at: null }, { required: true, done_at: "x" }])).toBe(false);
  });
  it("the text lists the number of jobs", () => {
    expect(prestartSubject("two_days", 3)).toBe("Reminder: 3 jobs start within 2 business days and haven't had the pre-start checklist filled out");
    expect(prestartSubject("final", 1)).toBe("FINAL reminder: 1 job starts next business day and hasn't had the pre-start checklist filled out");
  });
  it("the email lists customer, address, phone and the link, escaped", () => {
    const { subject, html } = followupEmail([{ customer: "Jo <b>", address: "1 High St", phone: "0412 345 678", link: "https://x/quote?id=1", sentOn: "Fri 9 Oct", title: "" }], "Paint Group");
    expect(subject).toBe("Today's follow ups — 1 estimate sent 3 days ago, not accepted");
    expect(html).toContain("Jo &lt;b&gt;");
    expect(html).toContain("1 High St");
    expect(html).toContain('href="tel:0412345678"');
    expect(html).toContain("https://x/quote?id=1");
  });
});
