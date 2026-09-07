import { describe, expect, it } from "vitest";
import type { DraftResult } from "@/lib/extract/draft";
import { applyWizardAnswers, conditionPhotoCount, PHOTO_REVIEW_KIND } from "./merge";
import { customerPayload } from "./view";
import { defaultWizardState, type WizardState } from "./state";

/**
 * Tom, 7 Sep 2026: photos a customer attaches to show the condition are
 * ALWAYS an estimator sign-off before the price is fixed. Before this,
 * attaching photos REMOVED the only review flag (the "damage to price"
 * deferral was raised only when there were NO photos).
 */
const state = (over: Partial<WizardState> = {}): WizardState => ({
  ...defaultWizardState(),
  noPlan: true,
  basics: { bedrooms: 2, storeys: "single", sizeBand: "unsure", openPlanKitchenLiving: false },
  ...over,
});
const draft = (): DraftResult => ({ areas: [], skipped: [], deferred: [], assumedCount: 0, warnings: [] } as unknown as DraftResult);
let id = 1;

describe("condition photos → estimator sign-off", () => {
  it("counts the claimed photos or the kept rows, whichever is larger", () => {
    expect(conditionPhotoCount({ details: { ...defaultWizardState().details, damagePhotoCount: 2 }, conditionSourceIds: [] })).toBe(2);
    expect(conditionPhotoCount({ details: { ...defaultWizardState().details, damagePhotoCount: 0 }, conditionSourceIds: ["a", "b", "c"] })).toBe(3);
  });

  it("raises the photo_review deferral for any attached photo — with or without stated damage", () => {
    const s = state({ details: { ...defaultWizardState().details, damageTier: 1, damagePhotoCount: 3 } });
    const m = applyWizardAnswers(draft(), s, () => id++);
    const d = m.deferred.find((x) => x.kind === PHOTO_REVIEW_KIND);
    expect(d).toBeTruthy();
    expect(d!.count).toBe(3);
    expect(d!.room).toBe("Whole job");
  });

  it("raises nothing when there are no photos (the old damage-to-price rule still covers tier ≥ 2)", () => {
    const m = applyWizardAnswers(draft(), state({ details: { ...defaultWizardState().details, damageTier: 2, damagePhotoCount: 0 } }), () => id++);
    expect(m.deferred.some((x) => x.kind === PHOTO_REVIEW_KIND)).toBe(false);
    expect(m.deferred.some((x) => x.what === "damage to price")).toBe(true);
  });

  it("tells the customer their photos are with the estimator — never the internal note", () => {
    const payload = {
      rooms: [], totals: { totalCents: 500_000 }, accuracyPct: 80, heightUnconfirmed: false, exteriorWidthFromPlan: false, exteriorWidthMissing: false,
      deferred: [{ room: "Whole job", areaId: null, what: "condition photos — estimator sign-off", count: 2, needs: "2 condition photos attached — review them and price any extra preparation before send", kind: PHOTO_REVIEW_KIND }],
    } as unknown as Parameters<typeof customerPayload>[0];
    const c = customerPayload(payload, [], { outcome: "reveal", reasons: [], walkthroughRequired: true, canAccept: false }, { tightMin: 90, tightPct: 4, midPct: 8, widePct: 15 } as never);
    expect(c.photosPendingSignOff).toBe(true);
    expect(c.confirmOnSite[0]).toMatch(/photos are with your estimator/);
    expect(c.confirmOnSite[0]).not.toMatch(/before send/);
  });
});
