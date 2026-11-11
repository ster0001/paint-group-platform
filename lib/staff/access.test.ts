import { describe, it, expect } from "vitest";
import { areaForPath, canSee, firstVisibleHref, parseStaffAccess, visibleAreas } from "./access";

describe("staff access (Tom, 5 Sep)", () => {
  it("a missing key means visible; false hides; owners see everything", () => {
    const vis = { isOwner: false, access: parseStaffAccess({ crm: false, payments: "no", contacts: true, junk: false }) };
    expect(vis.access).toEqual({ crm: false, contacts: true });
    expect(canSee(vis, "crm")).toBe(false);
    expect(canSee(vis, "payments")).toBe(true);
    expect(canSee(vis, "estimates")).toBe(true);
    expect(canSee({ isOwner: true, access: { crm: false } }, "crm")).toBe(true);
  });
  it("maps a path to its area, longest prefix first, and knows the builder is Estimates", () => {
    expect(areaForPath("/quote?id=abc")).toBe("estimates");
    expect(areaForPath("/invoices/123")).toBe("payments");   // one money area since the Payments merge (8d)
    expect(areaForPath("/invoicing/job/1")).toBe("payments");
    expect(areaForPath("/pc/wo/9")).toBe("projects");
    expect(areaForPath("/settings/showcase")).toBe("settings");
    expect(areaForPath("/account")).toBeNull();
  });
  it("sends a hidden visitor to their first visible area, and drops hidden entries from the rail", () => {
    const vis = { isOwner: false, access: { home: false, estimates: false, proving: false } };
    expect(firstVisibleHref(vis)).toBe("/pc");
    // Dashboard v2: Home is the first area, so a login that can see it lands there.
    expect(firstVisibleHref({ isOwner: false, access: { estimates: false } })).toBe("/home");
    expect(visibleAreas(vis)).not.toContain("estimates");
    expect(visibleAreas(vis)).toContain("settings");
    expect(firstVisibleHref({ isOwner: false, access: Object.fromEntries(visibleAreas({ isOwner: true, access: {} }).map((k) => [k, false])) })).toBe("/account");
  });
});

describe("views inside an area (Estimates tab ruling E‑N)", () => {
  it("a view is visible unless its own key or its area is false; owners see all", async () => {
    const { canSeeView, parseStaffAccess: parse } = await import("./access");
    expect(canSeeView({ isOwner: false, access: {} }, "estimates_pipeline")).toBe(true);
    expect(canSeeView({ isOwner: false, access: parse({ estimates_pipeline: false }) }, "estimates_pipeline")).toBe(false);
    expect(canSeeView({ isOwner: false, access: parse({ estimates_pipeline: false }) }, "estimates_funnel")).toBe(true);
    expect(canSeeView({ isOwner: false, access: { estimates: false } }, "estimates_funnel")).toBe(false);
    expect(canSeeView({ isOwner: true, access: { estimates_pipeline: false } }, "estimates_pipeline")).toBe(true);
  });
});
