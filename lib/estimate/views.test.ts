import { describe, expect, it } from "vitest";
import { ESTIMATE_VIEWS, ESTIMATE_VIEW_LABEL, estimateViewHref, parseEstimateView } from "./views";

describe("the estimates views (brief §4, R11)", () => {
  it("are the six chips in the brief's order, All estimates first", () => {
    expect(ESTIMATE_VIEWS.map((v) => ESTIMATE_VIEW_LABEL[v])).toEqual([
      "All estimates", "Pipeline", "Online now", "Work queue", "Funnel", "Campaigns › Automations",
    ]);
  });
  it("default to All estimates for no view, an unknown one, or the link-out", () => {
    for (const raw of [undefined, "", "nope", "all", "automations"]) expect(parseEstimateView(raw)).toBe("all");
    expect(parseEstimateView("funnel")).toBe("funnel");
  });
  it("All estimates is plain /estimates, so the list's old links still land on it", () => {
    expect(estimateViewHref("all")).toBe("/estimates");
    expect(estimateViewHref("pipeline")).toBe("/estimates?view=pipeline");
    expect(estimateViewHref("automations")).toBe("/crm/campaigns");
  });
});
