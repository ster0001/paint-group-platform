import { describe, expect, it } from "vitest";
import { SUCCESS_MOMENT_KEYS, isSuccessMoment, safeBack, thanksHref } from "./success";
import { adTagIdsFor } from "./adTags";
import { MARKETING_EVENT_NAMES } from "@/lib/analytics";

/** Success URLs for paid marketing (Tom, 17 Nov 2026). */
describe("success URLs", () => {
  it("the seven moments Tom chose, each its own /thanks/ page", () => {
    expect(SUCCESS_MOMENT_KEYS).toEqual(["range", "visit", "call", "call-tap", "message", "accepted", "deposit-paid"]);
    expect(thanksHref("deposit-paid", "/i/abc?pay=success")).toBe("/thanks/deposit-paid?back=%2Fi%2Fabc%3Fpay%3Dsuccess");
    expect(isSuccessMoment("accepted")).toBe(true);
    expect(isSuccessMoment("toString")).toBe(false);
  });
  it("back is a path on this site only — never an open redirect", () => {
    expect(safeBack("/e/tok")).toBe("/e/tok");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "", null, "/javascript:alert(1)"]) expect(safeBack(bad)).toBe("/");
  });
  it("the page view is one of our own events", () => {
    expect(MARKETING_EVENT_NAMES).toContain("success_page");
  });
  it("ad tags come only from the environment, per brand", () => {
    expect(adTagIdsFor("home")).toEqual({ metaPixelId: process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "", googleTagId: process.env.NEXT_PUBLIC_GOOGLE_TAG_ID ?? "" });
  });
});
