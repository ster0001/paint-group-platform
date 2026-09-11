import { describe, expect, test } from "vitest";
import { canAct, isOverdue, priceToFix, type ConfirmationRow } from "./confirmation-actions";

/**
 * C6 — fix, ask, visit. The accept line is "a fixed price can only originate
 * from the RPC", so these are the rules that RPC enforces.
 */

const row = (over: Partial<ConfirmationRow> = {}): ConfirmationRow =>
  ({ status: "requested", kind: "remote", ...over });

describe("what may be done, and when", () => {
  test("an open request takes all three actions", () => {
    for (const a of ["fix_price", "ask_question", "book_visit"] as const) {
      expect(canAct(row(), a).ok).toBe(true);
    }
  });

  test("asking a question is not terminal — the answer should let it carry on", () => {
    expect(canAct(row({ status: "question_asked" }), "fix_price")).toEqual({ ok: true, nextStatus: "fixed" });
  });

  test("a FIXED price cannot be re-fixed — that is a variation, with a signature", () => {
    const v = canAct(row({ status: "fixed", fixed_price_cents: 480_000 }), "fix_price");
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/variation/i);
  });

  test("nor can a fixed request be re-opened by asking or booking", () => {
    expect(canAct(row({ status: "fixed" }), "ask_question").ok).toBe(false);
    expect(canAct(row({ status: "fixed" }), "book_visit").ok).toBe(false);
  });

  test("a declined request is done", () => {
    expect(canAct(row({ status: "declined" }), "fix_price").ok).toBe(false);
  });

  test("a booked visit still allows a fix afterwards, but not a second booking", () => {
    expect(canAct(row({ status: "visit_booked" }), "fix_price").ok).toBe(true);
    expect(canAct(row({ status: "visit_booked" }), "book_visit").ok).toBe(false);
  });

  test("each action names the status it moves to — the route never invents one", () => {
    expect(canAct(row(), "fix_price")).toEqual({ ok: true, nextStatus: "fixed" });
    expect(canAct(row(), "ask_question")).toEqual({ ok: true, nextStatus: "question_asked" });
    expect(canAct(row(), "book_visit")).toEqual({ ok: true, nextStatus: "visit_booked" });
  });
});

describe("the price a fix records", () => {
  test("accepting takes the CENTRAL estimate, never the top of the band (⚑8)", () => {
    const p = priceToFix({ rangeLoCents: 400_000, rangeHiCents: 600_000 });
    expect(p).toEqual({ ok: true, cents: 500_000, source: "central" });
  });

  test("an entered number is taken as given — the estimator saw the job", () => {
    expect(priceToFix({ enteredCents: 512_345, rangeLoCents: 400_000, rangeHiCents: 600_000 }))
      .toEqual({ ok: true, cents: 512_345, source: "entered" });
  });

  test("an entered number may sit outside the range — that is the point of a person", () => {
    expect(priceToFix({ enteredCents: 900_000, rangeLoCents: 400_000, rangeHiCents: 600_000 }).ok).toBe(true);
  });

  test("but it must be money", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(priceToFix({ enteredCents: bad, rangeLoCents: 400_000, rangeHiCents: 600_000 }).ok).toBe(false);
    }
  });

  test("an unpriced estimate cannot be accepted into a fix", () => {
    const p = priceToFix({ rangeLoCents: 0, rangeHiCents: 0 });
    expect(p.ok).toBe(false);
    expect(p.ok === false && p.reason).toMatch(/builder/i);
  });
});

describe("overdue is measured in business hours, not wall-clock", () => {
  // Melbourne time; the suite runs under TZ=Australia/Melbourne.
  const friday5pm = new Date("2026-09-11T17:00:00+10:00");

  test("a Friday-evening request is not late on Saturday morning", () => {
    expect(isOverdue({
      requestedAt: friday5pm,
      now: new Date("2026-09-12T09:00:00+10:00"),
      turnaroundHours: 8,
    })).toBe(false);
  });

  test("and is still not late on Sunday night — no business hours have passed", () => {
    expect(isOverdue({
      requestedAt: friday5pm,
      now: new Date("2026-09-13T22:00:00+10:00"),
      turnaroundHours: 8,
    })).toBe(false);
  });

  test("it IS late once Monday's working day has run", () => {
    expect(isOverdue({
      requestedAt: friday5pm,
      now: new Date("2026-09-14T17:30:00+10:00"),
      turnaroundHours: 8,
    })).toBe(true);
  });

  test("a Monday-morning request is late the same afternoon", () => {
    expect(isOverdue({
      requestedAt: new Date("2026-09-14T08:00:00+10:00"),
      now: new Date("2026-09-14T16:30:00+10:00"),
      turnaroundHours: 8,
    })).toBe(true);
  });

  test("and is not late an hour in", () => {
    expect(isOverdue({
      requestedAt: new Date("2026-09-14T08:00:00+10:00"),
      now: new Date("2026-09-14T09:00:00+10:00"),
      turnaroundHours: 8,
    })).toBe(false);
  });

  test("a nonsense timestamp is never overdue, rather than always", () => {
    expect(isOverdue({ requestedAt: "not a date", now: new Date(), turnaroundHours: 8 })).toBe(false);
  });
});
