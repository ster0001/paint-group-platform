import { describe, expect, it } from "vitest";
import { isRepeat, outcomeNoteFor, phoneOrNull, resumeNext, saveAndBookSchema } from "./save-and-book";

describe("C8 — Save & book, the pure half (addendum §4.17, ⚑26)", () => {
  it("email is required and must be an email; mobile and slot are optional", () => {
    expect(saveAndBookSchema.safeParse({ email: "a@b.co", screen: "quick:job" }).success).toBe(true);
    expect(saveAndBookSchema.safeParse({ email: "", screen: "quick:job" }).success).toBe(false);
    expect(saveAndBookSchema.safeParse({ email: "not-an-email", screen: "quick:job" }).success).toBe(false);
    expect(saveAndBookSchema.safeParse({ email: "a@b.co", screen: "quick:job", phone: "0412 000 000", slot: "Thu 10 Sep · 2:00 – 2:45" }).success).toBe(true);
    expect(saveAndBookSchema.safeParse({ email: "a@b.co" }).success).toBe(false); // the screen is the resume point
  });
  it("the outcome note says booked or call-me-back, and names the screen", () => {
    expect(outcomeNoteFor("Thu 10 Sep · 2:00 – 2:45", "quick:job")).toBe("Booked: Thu 10 Sep · 2:00 – 2:45 (Save & book from quick:job)");
    expect(outcomeNoteFor(undefined, "quick:place")).toBe("Call me back (Save & book from quick:place)");
  });
  it("a second tap with the same email and choice is a repeat; anything else is new", () => {
    const input = { email: "A@b.co", slot: undefined, screen: "quick:job" };
    expect(isRepeat({ email: "a@b.co", outcome: "visit_requested", outcome_note: outcomeNoteFor(undefined, "quick:job") }, input)).toBe(true);
    expect(isRepeat({ email: "other@b.co", outcome: "visit_requested", outcome_note: outcomeNoteFor(undefined, "quick:job") }, input)).toBe(false);
    expect(isRepeat({ email: "a@b.co", outcome: "none", outcome_note: null }, input)).toBe(false);
    expect(isRepeat({ email: "a@b.co", outcome: "visit_requested", outcome_note: outcomeNoteFor("Fri", "quick:job") }, input)).toBe(false);
    expect(isRepeat(null, input)).toBe(false);
  });
  it("the link lands on the estimate when there is one, else on the wizard", () => {
    expect(resumeNext("11111111-1111-4111-8111-111111111111")).toBe("/estimate/scope?id=11111111-1111-4111-8111-111111111111");
    expect(resumeNext(null)).toBe("/estimate");
  });
  it("a typed mobile has to look like one; empty is simply none", () => {
    expect(phoneOrNull("0412 000 000")).toBe("0412 000 000");
    expect(phoneOrNull("+61 412 000 000")).toBe("+61 412 000 000");
    expect(phoneOrNull("123")).toBeNull();
    expect(phoneOrNull(undefined)).toBeNull();
  });
});
