import { test, expect, beforeEach } from "vitest";
import { allowPublicPlaces, _resetPublicPlacesLimit } from "./publicLimit";

const req = (ip: string, site: string | null = "same-origin") =>
  new Request("http://x/api/places/autocomplete", {
    headers: { "x-forwarded-for": ip, ...(site ? { "sec-fetch-site": site } : {}) },
  });

beforeEach(() => _resetPublicPlacesLimit());

test("a human typing gets through; the 61st lookup in ten minutes does not", () => {
  for (let i = 0; i < 60; i++) expect(allowPublicPlaces(req("1.1.1.1"), "autocomplete", 1000)).toBe(true);
  expect(allowPublicPlaces(req("1.1.1.1"), "autocomplete", 1000)).toBe(false);
  expect(allowPublicPlaces(req("2.2.2.2"), "autocomplete", 1000)).toBe(true);
});

test("the window resets", () => {
  for (let i = 0; i < 20; i++) allowPublicPlaces(req("3.3.3.3"), "details", 0);
  expect(allowPublicPlaces(req("3.3.3.3"), "details", 0)).toBe(false);
  expect(allowPublicPlaces(req("3.3.3.3"), "details", 10 * 60_000 + 1)).toBe(true);
});

test("a cross-site caller is refused outright; a header-less caller (curl) is bucketed", () => {
  expect(allowPublicPlaces(req("4.4.4.4", "cross-site"), "autocomplete")).toBe(false);
  expect(allowPublicPlaces(req("4.4.4.4", null), "autocomplete")).toBe(true);
});
