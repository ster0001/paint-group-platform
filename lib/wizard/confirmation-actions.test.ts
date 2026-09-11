import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  canAct, holdDaysFromSettings, holdUntil, holdWords, isOverdue, priceToFix,
  type ConfirmationRow,
} from "./confirmation-actions";

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
  test("accepting takes the ENGINE'S central estimate, never the top of the band (⚑8)", () => {
    const p = priceToFix({ centralCents: 500_000 });
    expect(p).toEqual({ ok: true, cents: 500_000, source: "central" });
  });

  test("an entered number is taken as given — the estimator saw the job", () => {
    expect(priceToFix({ enteredCents: 512_345, centralCents: 500_000 }))
      .toEqual({ ok: true, cents: 512_345, source: "entered" });
  });

  test("an entered number may sit outside the range — that is the point of a person", () => {
    expect(priceToFix({ enteredCents: 900_000, centralCents: 500_000 }).ok).toBe(true);
  });

  test("but it must be money", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(priceToFix({ enteredCents: bad, centralCents: 500_000 }).ok).toBe(false);
    }
  });

  test("an unpriced estimate cannot be accepted into a fix", () => {
    const p = priceToFix({ centralCents: 0 });
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

  /**
   * The office opens at 9 (businessHours.OPEN_HOUR), so a request that arrives
   * at 8 does not start counting until then. Eight business hours later is
   * 17:00 — the close — and that is the first moment it is late. An earlier
   * version of this test assumed an 8am start and was wrong about the product,
   * not about the code.
   */
  test("a request waiting before the office opens is late at close, not before", () => {
    const beforeOpen = new Date("2026-09-14T08:00:00+10:00");
    expect(isOverdue({ requestedAt: beforeOpen, now: new Date("2026-09-14T16:30:00+10:00"), turnaroundHours: 8 })).toBe(false);
    expect(isOverdue({ requestedAt: beforeOpen, now: new Date("2026-09-14T17:00:00+10:00"), turnaroundHours: 8 })).toBe(true);
  });

  test("and is not late an hour in", () => {
    expect(isOverdue({
      requestedAt: new Date("2026-09-14T09:00:00+10:00"),
      now: new Date("2026-09-14T10:00:00+10:00"),
      turnaroundHours: 8,
    })).toBe(false);
  });

  /**
   * The reason this uses addBusinessHours rather than its own loop: under
   * TZ=UTC the hand-rolled version called a Friday-evening request overdue on
   * Saturday, because getHours()/getDay() answer in the RUNTIME's zone and the
   * server is not in Melbourne. Both of these must hold in either zone.
   */
  test("the answer does not depend on the server's timezone", () => {
    const friday = new Date("2026-09-11T17:00:00+10:00");
    expect(isOverdue({ requestedAt: friday, now: new Date("2026-09-12T09:00:00+10:00"), turnaroundHours: 8 })).toBe(false);
    expect(isOverdue({ requestedAt: friday, now: new Date("2026-09-14T17:30:00+10:00"), turnaroundHours: 8 })).toBe(true);
  });

  test("a nonsense timestamp is never overdue, rather than always", () => {
    expect(isOverdue({ requestedAt: "not a date", now: new Date(), turnaroundHours: 8 })).toBe(false);
  });
});

describe("the hold on a fixed price (C7)", () => {
  test("60 days is the default, and an unset or nonsense setting gets it", () => {
    for (const bad of [null, undefined, {}, { days: 0 }, { days: -5 }, { days: "sixty" }, "sixty"]) {
      expect(holdDaysFromSettings(bad)).toBe(60);
    }
  });

  test("Tom's number wins, whether the row is a scalar or {days}", () => {
    expect(holdDaysFromSettings({ days: 30 })).toBe(30);
    expect(holdDaysFromSettings(14)).toBe(14);
  });

  test("a year is the ceiling — past that it is a rate card, not a held price", () => {
    expect(holdDaysFromSettings({ days: 4000 })).toBe(365);
  });

  test("the date is counted in MELBOURNE's calendar day, not the runtime's", () => {
    // 9:00am Monday 14 Sep in Melbourne is 23:00 Sunday 13 Sep UTC. A server
    // counting its own day would hold to 12 Nov; the customer was promised
    // 60 days from Monday, which is the 13th.
    const nineAmMonday = new Date("2026-09-14T09:00:00+10:00");
    expect(holdUntil(nineAmMonday, 60)).toBe("2026-11-13");
  });

  test("the words follow the number, so the copy cannot say 60 while we hold 30", () => {
    expect(holdWords(60)).toBe("held for 60 days");
    expect(holdWords(30)).toBe("held for 30 days");
    expect(holdWords(14)).toBe("held for 2 weeks");
    expect(holdWords(1)).toBe("held for a day");
  });
});

/**
 * THE GUARD THAT ACTUALLY FIRES.
 *
 * The Melbourne test above documents the rule but cannot enforce it: the suite
 * runs under TZ=Australia/Melbourne, so a naive `getDate()` implementation
 * agrees with the correct one on every input and the test stays green. Proven
 * by hand — reverting `holdUntil` to `from.getDate()` passes under Melbourne
 * and fails under TZ=UTC. A CI runner in UTC would have caught it; ours is not.
 *
 * This file decides two things a customer is told — when we will have answered
 * and how long their price stands — and both are dates. So the invariant is
 * read off the SOURCE instead: the runtime-local accessors are the trap
 * CLAUDE.md names, they are what made `isOverdue` wrong the first time, and
 * none of them belongs in here. `getTime` is zone-free and stays allowed.
 */
test("no date accessor in this file answers in the runtime's timezone", () => {
  const src = readFileSync(new URL("./confirmation-actions.ts", import.meta.url), "utf8");
  const banned = src.match(/\.get(FullYear|Month|Date|Day|Hours|Minutes)\b/g) ?? [];
  expect(banned).toEqual([]);
});
