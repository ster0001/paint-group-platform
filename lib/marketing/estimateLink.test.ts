import { describe, it, expect, test } from "vitest";
import { estimateHref, isMode } from "./estimateLink";

test("address and mode ride the URL, encoded", () => {
  const href = estimateHref("12 Elm Street, Northcote VIC 3070", "home");
  const url = new URL(href, "http://x");
  expect(url.pathname).toBe("/estimate");
  expect(url.searchParams.get("address")).toBe("12 Elm Street, Northcote VIC 3070");
  expect(url.searchParams.get("mode")).toBe("home");
});

test("an empty address is omitted; the mode always travels", () => {
  const url = new URL(estimateHref("   ", "business"), "http://x");
  expect(url.searchParams.has("address")).toBe(false);
  expect(url.searchParams.get("mode")).toBe("business");
});

test("isMode accepts only the two chips", () => {
  expect(isMode("home")).toBe(true);
  expect(isMode("business")).toBe(true);
  expect(isMode("biz")).toBe(false);
  expect(isMode(undefined)).toBe(false);
});

describe("paid-ad parameters ride the hand-off (6 Sep)", () => {
  it("carries utm_* and click ids, drops everything else, clamps values", () => {
    const href = estimateHref("12 Elm St", "business", {
      src: "commercial_home_hero", origin: "https://new.paintgroup.com.au",
      carry: "?utm_source=google&utm_medium=cpc&utm_campaign=vacate&gclid=abc123&fbclid=&foo=bar&utm_term=" + "x".repeat(300),
    });
    const u = new URL(href);
    expect(u.origin + u.pathname).toBe("https://new.paintgroup.com.au/estimate");
    expect(u.searchParams.get("mode")).toBe("business");
    expect(u.searchParams.get("src")).toBe("commercial_home_hero");
    expect(u.searchParams.get("utm_source")).toBe("google");
    expect(u.searchParams.get("utm_campaign")).toBe("vacate");
    expect(u.searchParams.get("gclid")).toBe("abc123");
    expect(u.searchParams.get("foo")).toBeNull();
    expect(u.searchParams.get("fbclid")).toBeNull();
    expect(u.searchParams.get("utm_term")?.length).toBe(200);
  });
  it("no tags, no change", () => {
    expect(estimateHref("", "home", { carry: "" })).toBe("/estimate?mode=home");
  });
});
