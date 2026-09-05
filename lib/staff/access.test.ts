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
    expect(areaForPath("/invoices/123")).toBe("invoicing");
    expect(areaForPath("/invoicing/job/1")).toBe("payments");
    expect(areaForPath("/pc/wo/9")).toBe("projects");
    expect(areaForPath("/settings/showcase")).toBe("settings");
    expect(areaForPath("/account")).toBeNull();
  });
  it("sends a hidden visitor to their first visible area, and drops hidden entries from the rail", () => {
    const vis = { isOwner: false, access: { estimates: false, proving: false } };
    expect(firstVisibleHref(vis)).toBe("/pc");
    expect(visibleAreas(vis)).not.toContain("estimates");
    expect(visibleAreas(vis)).toContain("settings");
    expect(firstVisibleHref({ isOwner: false, access: Object.fromEntries(visibleAreas({ isOwner: true, access: {} }).map((k) => [k, false])) })).toBe("/account");
  });
});
