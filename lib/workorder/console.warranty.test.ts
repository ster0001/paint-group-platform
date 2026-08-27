import { describe, expect, it } from "vitest";
import { buildQueue, type ConsoleInput } from "./console";

/** 3a-5: the portal's "Report an issue" submissions surface as PC cards
 * that clear when marked handled (the caller only feeds open rows). */

const base: ConsoleInput = {
  now: new Date("2026-08-27T06:00:00Z"),
  workOrders: [{
    id: "wo1", woRef: "WO-0042", stage: "closed", title: "12 Acacia Street",
    contractorName: "Kovac Painting", contractValueCents: 845_000, startDate: null,
    coloursConfirmed: true, blockedReason: null, acceptedAt: null, issued: true,
    estimateId: "e1", ticksDone: 4, ticksTotal: 4,
  }],
  offers: [], variations: [], updates: [], signoffs: [], quietSites: [],
  settings: { coloursWarnDays: 5, updateEveryDays: 3, variationCustomerSilentHours: 24 },
} as unknown as ConsoleInput;

describe("warranty-issue console cards", () => {
  it("one open report = one warning card, deep-linked to the job", () => {
    const cards = buildQueue({
      ...base,
      warrantyIssues: [{
        id: "wi1", workOrderId: "wo1", note: "Paint bubbling near the laundry window",
        photoCount: 2, createdAt: "2026-08-26T06:00:00Z",
      }],
    });
    const card = cards.find((c) => c.key === "warranty-issue:wi1");
    expect(card).toBeTruthy();
    expect(card!.severity).toBe("warning");
    expect(card!.detail).toContain("bubbling");
    expect(card!.detail).toContain("2 photos");
    expect(card!.action.href).toBe("/pc/wo/wo1");
    expect(Math.round(card!.ageHours)).toBe(24);
  });

  it("no open issues, no card — resolving clears it without a dismiss", () => {
    const cards = buildQueue({ ...base, warrantyIssues: [] });
    expect(cards.some((c) => c.key.startsWith("warranty-issue:"))).toBe(false);
  });
});
