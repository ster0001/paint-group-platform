import { describe, expect, it } from "vitest";
import { DERIVED_SETTINGS, detectManual, isDerivedSetting, resolveDerived } from "./derived";

/** The levers as they ship in `supabase/seed/ratecard_v7.sql`. */
const V7 = {
  "Charge-out rate — INTERIOR": 85,
  "Charge-out rate — EXTERIOR": 100,
  "Contractor rate": 60,
  "Weekly fixed costs": 4000,
  "Weekly marketing": 1200,
  "Billable hours per week": 480,
  "Total weekly overhead": 5200,
  "Overhead per billable hour": 10.8333333333333,
  "Break-even charge-out rate": 70.8333333333333,
  "Labour spread — interior": 25,
  "Labour spread — exterior": 40,
  "Contribution per hour — INTERIOR": 14.1666666666667,
  "Contribution per hour — EXTERIOR": 29.1666666666667,
};

/** The same levers at the v8 figures from `docs/briefs/claude-code-brief-ratecard-v8.md`. */
const V8_LEVERS = {
  "Charge-out rate — INTERIOR": 95,
  "Charge-out rate — EXTERIOR": 108,
  "Contractor rate": 60,
  "Weekly fixed costs": 4000,
  "Weekly marketing": 1200,
  "Billable hours per week": 445,
};

const rowsOf = (o: Record<string, number>) =>
  Object.entries(o).map(([key, n]) => ({ key, text: String(n), manual: false }));

const valueOf = (o: Record<string, number>, key: string) => {
  const rows = rowsOf(o);
  const i = rows.findIndex((r) => r.key === key);
  return resolveDerived(rows)[i].display;
};

describe("the calculated pricing rows", () => {
  it("reproduces every v7 figure from the levers alone", () => {
    // Only the levers — the seven calculated rows are absent and must appear.
    const levers = {
      "Charge-out rate — INTERIOR": 85,
      "Charge-out rate — EXTERIOR": 100,
      "Contractor rate": 60,
      "Weekly fixed costs": 4000,
      "Weekly marketing": 1200,
      "Billable hours per week": 480,
      ...Object.fromEntries(DERIVED_SETTINGS.map((d) => [d.key, 0])),
    };
    expect(valueOf(levers, "Total weekly overhead")).toBe("5200");
    expect(valueOf(levers, "Overhead per billable hour")).toBe("10.83");
    expect(valueOf(levers, "Break-even charge-out rate")).toBe("70.83");
    expect(valueOf(levers, "Labour spread — interior")).toBe("25");
    expect(valueOf(levers, "Labour spread — exterior")).toBe("40");
    expect(valueOf(levers, "Contribution per hour — INTERIOR")).toBe("14.17");
    expect(valueOf(levers, "Contribution per hour — EXTERIOR")).toBe("29.17");
  });

  it("reproduces the v8 brief's figures to the cent", () => {
    const levers = { ...V8_LEVERS, ...Object.fromEntries(DERIVED_SETTINGS.map((d) => [d.key, 0])) };
    expect(valueOf(levers, "Overhead per billable hour")).toBe("11.69");
    expect(valueOf(levers, "Break-even charge-out rate")).toBe("71.69");
    expect(valueOf(levers, "Labour spread — interior")).toBe("35");
    expect(valueOf(levers, "Labour spread — exterior")).toBe("48");
    expect(valueOf(levers, "Contribution per hour — INTERIOR")).toBe("23.31");
    expect(valueOf(levers, "Contribution per hour — EXTERIOR")).toBe("36.31");
  });

  it("treats the shipped v7 rows as in agreement, not as overrides", () => {
    // The seed stores 10.8333333333333; the formula gives 10.83. Same figure.
    const flags = detectManual(rowsOf(V7));
    expect(flags.some(Boolean)).toBe(false);
  });

  it("flags the v7→v8 drift: raise charge-out and leave contribution behind", () => {
    const drifted = { ...V7, "Charge-out rate — INTERIOR": 95 };
    const rows = rowsOf(drifted);
    const flags = detectManual(rows);
    const flagged = rows.filter((r, i) => flags[i]).map((r) => r.key);
    expect(flagged).toEqual(["Labour spread — interior", "Contribution per hour — INTERIOR"]);
  });

  it("does not let one stale row upstream accuse every row below it", () => {
    // The live settings on 22 Aug: total weekly overhead had drifted off
    // fixed+marketing, and overhead per hour was still the v7 figure. Break-even
    // agrees with ITS OWN stored inputs (60 + 10.8333 = 70.83) and must not be
    // flagged just because something above it had.
    const live = {
      "Charge-out rate — INTERIOR": 95,
      "Charge-out rate — EXTERIOR": 105,
      "Contractor rate": 60,
      "Weekly fixed costs": 4000,
      "Weekly marketing": 1745,
      "Billable hours per week": 398,
      "Total weekly overhead": 5847,
      "Overhead per billable hour": 10.8333333333333,
      "Break-even charge-out rate": 70.8333333333333,
    };
    const rows = rowsOf(live);
    const flags = detectManual(rows);
    const flagged = rows.filter((r, i) => flags[i]).map((r) => r.key);
    expect(flagged).toEqual(["Total weekly overhead", "Overhead per billable hour"]);
  });

  it("treats a full-precision stored figure as agreeing with its rounded formula", () => {
    // 70.8333333333333 IS 70.83 — comparing raw floats would call it an override.
    const flags = detectManual(rowsOf({ ...V7 }));
    expect(flags.some(Boolean)).toBe(false);
  });

  it("agrees with the corrected live settings — nothing flags as an override", () => {
    // Written 22 Aug after finding 5847 sitting in Total weekly overhead when
    // docs/manual-tests/tom-batch-23aug.md shows it is the WEEKLY FIXED COSTS
    // figure, with marketing on top. Break-even was reading 70.83 against a
    // true 79.08. If this ever flags again, a lever moved and a row did not.
    const corrected = {
      "Charge-out rate — INTERIOR": 95,
      "Charge-out rate — EXTERIOR": 105,
      "Contractor rate": 60,
      "Weekly fixed costs": 5847,
      "Weekly marketing": 1745,
      "Billable hours per week": 398,
      "Total weekly overhead": 7592,
      "Overhead per billable hour": 19.08,
      "Break-even charge-out rate": 79.08,
      "Labour spread — interior": 35,
      "Labour spread — exterior": 45,
      "Contribution per hour — INTERIOR": 15.92,
      "Contribution per hour — EXTERIOR": 25.92,
    };
    const rows = rowsOf(corrected);
    expect(rows.filter((r, i) => detectManual(rows)[i]).map((r) => r.key)).toEqual([]);
    // And exterior really is the thinner of the two at these rates.
    expect(valueOf(corrected, "Contribution per hour — EXTERIOR")).toBe("25.92");
  });

  it("carries an override downstream exactly as it reads on screen", () => {
    const rows = rowsOf({ ...V7 }).map((r) =>
      // Overhead per hour pinned by hand; break-even and contribution follow IT.
      r.key === "Overhead per billable hour" ? { ...r, text: "20", manual: true } : r,
    );
    const out = resolveDerived(rows);
    const at = (key: string) => out[rows.findIndex((r) => r.key === key)].display;
    expect(at("Overhead per billable hour")).toBe("20");
    expect(at("Break-even charge-out rate")).toBe("80");
    expect(at("Contribution per hour — INTERIOR")).toBe("5");
  });

  it("leaves a row alone when an input is missing rather than printing nonsense", () => {
    const rows = rowsOf({ "Contribution per hour — INTERIOR": 14.17 });
    const out = resolveDerived(rows);
    expect(out[0].computed).toBeNull();
    expect(out[0].display).toBe("14.17");
  });

  it("does not divide by zero billable hours", () => {
    const rows = rowsOf({ ...V7, "Billable hours per week": 0 });
    const i = rows.findIndex((r) => r.key === "Overhead per billable hour");
    expect(resolveDerived(rows)[i].computed).toBeNull();
  });

  it("knows which keys are calculated, em dashes and all", () => {
    expect(isDerivedSetting("Contribution per hour — INTERIOR")).toBe(true);
    expect(isDerivedSetting("Contractor rate")).toBe(false);
    expect(isDerivedSetting("Contractor offer — % of estimated hours")).toBe(false);
  });
});
