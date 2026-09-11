import { describe, expect, it } from "vitest";
import { stripParts, stripVerdict } from "./strip";

const base = {
  loop: { confirmed: 9, total: 9, unit: "rooms" as const },
  bandPct: 4, photos: 7, spotsToPrice: 1, totalCents: 1_013_000,
  verdict: { eligible: true, reason: "" },
  policy: { remoteConfirmCapCents: 1_200_000 },
};

describe("the strip (brief 3.1) — words over figures the pack already derived", () => {
  it("reads as the mockup's line", () => {
    expect(stripParts(base).join(" · ")).toBe("9 of 9 rooms confirmed · ±4% · 7 photos · 1 repair to price · under the $12k cap");
  });
  it("drops what is absent rather than printing zeros", () => {
    expect(stripParts({ ...base, loop: null, spotsToPrice: 0, photos: 0 }).join(" · ")).toBe("±4% · 0 photos · under the $12k cap");
  });
  it("says over the cap when it is, sides when it is sides", () => {
    expect(stripParts({ ...base, totalCents: 1_300_000, loop: { confirmed: 3, total: 4, unit: "sides" }, spotsToPrice: 2 }))
      .toEqual(["3 of 4 sides confirmed", "±4%", "7 photos", "2 repairs to price", "over the $12k cap"]);
  });
  it("the verdict is the pack's, not a re-derivation", () => {
    expect(stripVerdict({ verdict: { eligible: true, reason: "" } })).toEqual({ headline: "Confirm remotely", detail: "no visit needed" });
    expect(stripVerdict({ verdict: { eligible: false, reason: "it has exterior work — v1 confirms interiors only" } }).detail).toMatch(/exterior/);
  });
});
