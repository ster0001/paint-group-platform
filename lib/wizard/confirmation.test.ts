import { describe, expect, test } from "vitest";
import { confirmationDraft, estimatorForPostcode, queueScore, sortQueue, type EstimatorPatch } from "./confirmation";
import type { DeskCheckPack } from "./desk-check";

/**
 * C5 — the qualified lead as a row. These pin the three decisions the row
 * carries that the old jsonb marker could not: what we are asking for, what
 * the rules suggested, and whose patch it is.
 */

const pack = (over: Partial<DeskCheckPack> = {}): DeskCheckPack => ({
  verdict: { eligible: true, reason: "" },
  totalCents: 480_000,
  hasExterior: false,
  rooms: [],
  spotCount: 0,
  spotsToPrice: 0,
  systems: [],
  access: [],
  open: [],
  clean: true,
  ...over,
} as DeskCheckPack);

const staff: EstimatorPatch[] = [
  { id: "sarah", postcodes: ["3121", "3122"] },
  { id: "dan", postcodes: ["3163"] },
  { id: "nobody", postcodes: [] },
];

describe("what the send is asking for", () => {
  test("an eligible job asks for a REMOTE confirmation", () => {
    const d = confirmationDraft({ pack: pack(), postcode: "3121", staff });
    expect(d.kind).toBe("remote");
    expect(d.suggestedAction).toBe("fix");
  });

  test("a job the ladder will not confirm remotely asks for a VISIT, and says why", () => {
    const d = confirmationDraft({
      pack: pack({ verdict: { eligible: false, reason: "it has exterior work — v1 confirms interiors only" } }),
      postcode: "3121", staff,
    });
    expect(d.kind).toBe("visit");
    expect(d.suggestedAction).toBe("visit");
    // The customer is told the real reason, not a generic one.
    expect(d.why).toMatch(/exterior work/);
  });

  test("open questions make it an ASK, but it is still a remote request", () => {
    const d = confirmationDraft({
      pack: pack({ clean: false, open: [{ what: "ceiling height", needs: "confirm" }] as DeskCheckPack["open"] }),
      postcode: "3121", staff,
    });
    expect(d.kind).toBe("remote");
    expect(d.suggestedAction).toBe("ask");
    expect(d.why).toMatch(/things to settle/);
  });

  test("a spot a person still has to price is an ASK too", () => {
    const d = confirmationDraft({ pack: pack({ spotsToPrice: 1, clean: false }), postcode: "3121", staff });
    expect(d.suggestedAction).toBe("ask");
  });

  test("the kind follows the LADDER, never a second opinion", () => {
    // Same money, same everything — only the ladder's verdict differs.
    const yes = confirmationDraft({ pack: pack({ verdict: { eligible: true, reason: "" } }), postcode: "3121", staff });
    const no = confirmationDraft({ pack: pack({ verdict: { eligible: false, reason: "over the cap" } }), postcode: "3121", staff });
    expect(yes.kind).toBe("remote");
    expect(no.kind).toBe("visit");
  });
});

describe("whose patch it is", () => {
  test("a covered postcode finds its estimator", () => {
    expect(estimatorForPostcode("3121", staff)).toBe("sarah");
    expect(estimatorForPostcode("3163", staff)).toBe("dan");
  });
  test("an uncovered postcode assigns nobody — and that is a normal answer", () => {
    expect(estimatorForPostcode("9999", staff)).toBeNull();
  });
  test("no postcode assigns nobody rather than guessing", () => {
    expect(estimatorForPostcode(null, staff)).toBeNull();
    expect(estimatorForPostcode("  ", staff)).toBeNull();
  });
  test("someone with no patch is never auto-assigned", () => {
    expect(estimatorForPostcode("3121", [{ id: "nobody", postcodes: [] }])).toBeNull();
  });
  test("two people covering one postcode resolve the SAME way every time", () => {
    const both: EstimatorPatch[] = [{ id: "zoe", postcodes: ["3121"] }, { id: "adam", postcodes: ["3121"] }];
    expect(estimatorForPostcode("3121", both)).toBe("adam");
    expect(estimatorForPostcode("3121", [...both].reverse())).toBe("adam");
  });
});

describe("the queue's order — value × readiness", () => {
  test("a fixable job outranks a bigger one that needs a visit", () => {
    const fixable = { totalCents: 500_000, suggestedAction: "fix" as const };
    const bigger = { totalCents: 700_000, suggestedAction: "visit" as const };
    expect(queueScore(fixable)).toBeGreaterThan(queueScore(bigger));
  });

  test("at equal readiness, the money decides", () => {
    expect(queueScore({ totalCents: 900_000, suggestedAction: "fix" }))
      .toBeGreaterThan(queueScore({ totalCents: 400_000, suggestedAction: "fix" }));
  });

  test("a null suggestion is treated as the least ready, never the most", () => {
    expect(queueScore({ totalCents: 500_000, suggestedAction: null }))
      .toBeLessThan(queueScore({ totalCents: 500_000, suggestedAction: "fix" }));
  });

  test("a tie goes to whoever has waited longest", () => {
    const rows = [
      { totalCents: 500_000, suggestedAction: "fix" as const, requestedAt: "2026-09-11T10:00:00Z" },
      { totalCents: 500_000, suggestedAction: "fix" as const, requestedAt: "2026-09-11T08:00:00Z" },
    ];
    expect(sortQueue(rows)[0].requestedAt).toBe("2026-09-11T08:00:00Z");
  });

  test("age does NOT outrank money — an old small job stays below a new big one", () => {
    const rows = [
      { totalCents: 200_000, suggestedAction: "fix" as const, requestedAt: "2026-01-01T00:00:00Z" },
      { totalCents: 900_000, suggestedAction: "fix" as const, requestedAt: "2026-09-11T10:00:00Z" },
    ];
    expect(sortQueue(rows)[0].totalCents).toBe(900_000);
  });

  test("sorting does not mutate the caller's array", () => {
    const rows = [
      { totalCents: 100, suggestedAction: "fix" as const, requestedAt: "a" },
      { totalCents: 900, suggestedAction: "fix" as const, requestedAt: "b" },
    ];
    const copy = [...rows];
    sortQueue(rows);
    expect(rows).toEqual(copy);
  });
});
