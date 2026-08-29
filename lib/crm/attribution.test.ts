import { describe, expect, it } from "vitest";
import { recordTouch, resolveSource, sourceReport, touchFromLocation, type Touch } from "./attribution";

const at = "2026-08-29T00:00:00.000Z";
const touch = (over: Partial<Touch> = {}): Touch => ({ source: "direct", detail: "", path: "/", at, ...over });

describe("resolveSource", () => {
  it("reads a Google ad as paid, and organic Google as organic", () => {
    expect(resolveSource({ params: { utm_source: "google", utm_medium: "cpc", utm_campaign: "spring-ext" } }))
      .toEqual({ source: "paid_google", detail: "google · cpc · spring-ext" });
    expect(resolveSource({ params: { utm_source: "google", utm_medium: "organic" } }).source)
      .toBe("organic_search");
  });

  it("trusts a click id when the tagging failed", () => {
    expect(resolveSource({ params: { gclid: "abc123" } })).toEqual({ source: "paid_google", detail: "gclid" });
    expect(resolveSource({ params: { fbclid: "xyz" } }).source).toBe("paid_social");
  });

  it("treats a referral link as a referral whatever else is on the URL", () => {
    // A friend forwards a link that still carries the ad tags it was found
    // with. That is word of mouth, not a second ad click.
    expect(resolveSource({ params: { ref: "priya-raman", utm_source: "google", utm_medium: "cpc" } }))
      .toEqual({ source: "referral", detail: "priya-raman" });
  });

  it("falls back to the referring site when there are no tags", () => {
    expect(resolveSource({ referrer: "https://www.google.com/search?q=painters" }).source).toBe("organic_search");
    expect(resolveSource({ referrer: "https://www.facebook.com/somepage" }).source).toBe("social");
    expect(resolveSource({ referrer: "https://www.realestate.com.au/x" }).source).toBe("other");
  });

  it("is direct when nobody sent them, and when we sent them to ourselves", () => {
    expect(resolveSource({}).source).toBe("direct");
    expect(resolveSource({ referrer: "https://paintgroup.com.au/services" }).source).toBe("direct");
  });

  it("never throws on a mangled referrer", () => {
    expect(resolveSource({ referrer: "not a url" }).source).toBe("direct");
  });
});

describe("recordTouch — first touch is written once", () => {
  it("keeps the first and moves the last", () => {
    const first = touch({ source: "referral", detail: "priya", at: "2026-07-01T00:00:00.000Z" });
    const later = touch({ source: "paid_google", detail: "gclid", at: "2026-08-01T00:00:00.000Z" });
    const a = recordTouch(null, first);
    const b = recordTouch(a, later);
    expect(b.first).toEqual(first);
    expect(b.last).toEqual(later);
  });

  it("does not let a later ad click take credit for word of mouth", () => {
    // The whole point of first touch. A month of thinking between the two is
    // the normal case for a repaint, not the exception.
    const referral = touch({ source: "referral" });
    const ad = touch({ source: "paid_google" });
    expect(recordTouch(recordTouch(null, referral), ad).first?.source).toBe("referral");
  });
});

describe("touchFromLocation", () => {
  it("captures the source, the evidence and where they landed", () => {
    const t = touchFromLocation(
      new Date("2026-08-29T02:00:00.000Z"),
      { search: "?utm_source=google&utm_medium=cpc", pathname: "/estimate" },
      "https://www.google.com/",
    );
    expect(t).toEqual({ source: "paid_google", detail: "google · cpc", path: "/estimate", at: "2026-08-29T02:00:00.000Z" });
  });
});

describe("sourceReport", () => {
  it("counts leads, wins and revenue by source", () => {
    const { rows, totals } = sourceReport([
      { source: "referral", wonCents: 1_684_00 },
      { source: "referral", wonCents: null },
      { source: "paid_google", wonCents: 500_00 },
    ]);
    const referral = rows.find((r) => r.source === "referral")!;
    expect(referral).toMatchObject({ leads: 2, won: 1, revenueCents: 1_684_00, label: "Referral" });
    expect(totals).toEqual({ leads: 3, won: 2, revenueCents: 2_184_00 });
  });

  it("keeps the untagged half visible instead of quietly dropping it", () => {
    // A report that omits what it doesn't know reads as though the tagged
    // rows are the whole business.
    const { rows } = sourceReport([{ source: null, wonCents: null }, { source: "referral", wonCents: 100 }]);
    expect(rows.find((r) => r.source === "unknown")).toMatchObject({ leads: 1, label: "Not recorded" });
  });

  it("leaves out sources nobody has yet", () => {
    const { rows } = sourceReport([{ source: "referral", wonCents: null }]);
    expect(rows.map((r) => r.source)).toEqual(["referral"]);
  });
});
