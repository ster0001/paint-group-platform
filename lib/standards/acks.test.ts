import { describe, expect, test } from "vitest";
import {
  ackedCount, blocksOffers, mergeStandardsRules, needsSignoff, nextSignSection, SIGN_SECTIONS,
  standardsCardDueAt, standardsReminderLadder, standardsStatusOf, staffStatusLine, painterStatusLine,
} from "./acks";

const now = new Date("2026-10-08T03:00:00Z"); // 2 pm Melbourne (AEDT)

describe("standardsStatusOf — mirrors standards_status_of in 20270225", () => {
  const base = { employmentType: "contractor" as const, requiredNo: 1, confirmedNo: null, graceUntil: null };

  test("nothing published → nothing required, whoever asks", () => {
    expect(standardsStatusOf({ ...base, requiredNo: null }, now)).toBe("not_required");
    expect(standardsStatusOf({ ...base, requiredNo: null, employmentType: "employee" }, now)).toBe("not_required");
  });
  test("six sections on the required version, or a newer one, is confirmed", () => {
    expect(standardsStatusOf({ ...base, confirmedNo: 1 }, now)).toBe("confirmed");
    expect(standardsStatusOf({ ...base, confirmedNo: 2 }, now)).toBe("confirmed");
    // A wording-only v2 (not material) leaves the required version at 1, so v1 still counts.
    expect(standardsStatusOf({ ...base, requiredNo: 1, confirmedNo: 1, graceUntil: "2026-01-01T00:00:00Z" }, now)).toBe("confirmed");
  });
  test("a material new version makes an old confirmation insufficient", () => {
    expect(standardsStatusOf({ ...base, requiredNo: 2, confirmedNo: 1, graceUntil: "2026-10-15T00:00:00Z" }, now)).toBe("grace");
  });
  test("an employee is never blocked (⚑2)", () => {
    expect(standardsStatusOf({ ...base, employmentType: "employee" }, now)).toBe("employee_unsigned");
    expect(standardsStatusOf({ ...base, employmentType: "employee", graceUntil: "2026-01-01T00:00:00Z" }, now)).toBe("employee_unsigned");
  });
  test("a contractor: not invited → grace → blocked", () => {
    expect(standardsStatusOf(base, now)).toBe("not_invited");
    expect(standardsStatusOf({ ...base, graceUntil: "2026-10-15T00:00:00Z" }, now)).toBe("grace");
    expect(standardsStatusOf({ ...base, graceUntil: "2026-10-08T02:59:59Z" }, now)).toBe("blocked");
    // A new painter is invited with no grace: blocked from the first second.
    expect(standardsStatusOf({ ...base, graceUntil: now.toISOString() }, now)).toBe("blocked");
  });
  test("only blocked stops an offer; everything but confirmed / not required still needs a signature", () => {
    expect(blocksOffers("blocked")).toBe(true);
    for (const s of ["confirmed", "grace", "not_invited", "employee_unsigned", "not_required"] as const) expect(blocksOffers(s)).toBe(false);
    expect(needsSignoff("grace")).toBe(true);
    expect(needsSignoff("employee_unsigned")).toBe(true);
    expect(needsSignoff("confirmed")).toBe(false);
    expect(needsSignoff("not_required")).toBe(false);
  });
});

describe("the six sections", () => {
  test("in the mockup's order, resumable from the first unticked one", () => {
    expect(SIGN_SECTIONS.map((s) => s.key)).toEqual(["levels", "rules", "time", "interior", "exterior", "defect"]);
    expect(nextSignSection(new Set())).toBe("levels");
    expect(nextSignSection(new Set(["levels", "rules"]))).toBe("time");
    expect(nextSignSection(new Set(["levels", "time"]))).toBe("rules"); // order, not the newest tick
    expect(nextSignSection(new Set(SIGN_SECTIONS.map((s) => s.key)))).toBeNull();
    expect(ackedCount(new Set(["levels", "defect", "bogus"]))).toBe(2);
  });
  test("the sixth section carries the final checklist", () => {
    expect(SIGN_SECTIONS[5].body).toEqual(["defect", "checklist"]);
  });
});

describe("the numbers (settings.standards_rules)", () => {
  test("defaults, and a malformed row falls back field by field", () => {
    expect(mergeStandardsRules(null)).toEqual({ graceDays: 7, reminderDays: [2, 4, 6], reminderHour: 9, pcCardDay: 7 });
    expect(mergeStandardsRules({ graceDays: 14, reminderDays: [1, 3, 3, "x", 90], reminderHour: 25, pcCardDay: 0 }))
      .toEqual({ graceDays: 14, reminderDays: [1, 3], reminderHour: 9, pcCardDay: 7 });
    expect(mergeStandardsRules({ graceDays: 0 }).graceDays).toBe(0); // no grace is a legal ruling
  });
  test("the reminder ladder is whole days after 9 am Melbourne on the invite day", () => {
    const rules = mergeStandardsRules(null);
    // Invited 8 Oct 2026 23:30 Melbourne = 12:30Z — still the 8th in Melbourne.
    const { anchor, rungs } = standardsReminderLadder(new Date("2026-10-08T12:30:00Z"), rules);
    expect(anchor.toISOString()).toBe("2026-10-07T22:00:00.000Z"); // 9 am AEDT on the 8th
    expect(rungs).toEqual([{ id: "day2", afterHours: 48 }, { id: "day4", afterHours: 96 }, { id: "day6", afterHours: 144 }]);
    expect(standardsCardDueAt(new Date("2026-10-08T12:30:00Z"), rules).toISOString()).toBe("2026-10-14T22:00:00.000Z");
  });
});

describe("the words", () => {
  test("painter and office lines say the state, in words", () => {
    expect(painterStatusLine("blocked", {})).toMatch(/No job offers until/);
    expect(painterStatusLine("confirmed", { confirmedAt: "2026-10-07T01:00:00Z", confirmedNo: 1 })).toBe("You confirmed these on 7 Oct 2026 · Version 1");
    expect(staffStatusLine("grace", { invitedAt: "2026-10-05T00:00:00Z", graceUntil: "2026-10-12T00:00:00Z", now })).toBe("Not signed — invited 3d ago, offers stop 12 Oct 2026");
    expect(staffStatusLine("confirmed", { confirmedNo: 1, confirmedAt: "2026-10-07T01:00:00Z", now })).toBe("Confirmed v1 · 7 Oct 2026");
    expect(staffStatusLine("employee_unsigned", { now })).toBe("Not signed — not invited yet (employee)");
  });
});
