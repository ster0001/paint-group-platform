import { test, expect } from "vitest";
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
