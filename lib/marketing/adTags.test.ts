import { test, expect, afterEach } from "vitest";
import { isGtmContainerId, pushSuccessToDataLayer } from "./adTags";

const g = globalThis as unknown as { window?: { dataLayer?: unknown[] } };
afterEach(() => { delete g.window; });

test("a Tag Manager container id is told apart from a Google tag id", () => {
  for (const id of ["GTM-MRW23TH", "gtm-abc123", " GTM-XYZ1234 "]) expect(isGtmContainerId(id)).toBe(true);
  for (const id of ["G-ABC123DEF", "AW-123456789", "GT-ABCD123", ""]) expect(isGtmContainerId(id)).toBe(false);
});

test("a success moment goes into the data layer as one pg_success event, after what is already there", () => {
  g.window = { dataLayer: [{ "gtm.start": 1, event: "gtm.js" }] };
  pushSuccessToDataLayer("lead", true);
  expect(g.window.dataLayer).toEqual([
    { "gtm.start": 1, event: "gtm.js" },
    { event: "pg_success", success_moment: "lead", success_background: true },
  ]);
});

test("before the container has loaded, the push starts the data layer for it", () => {
  g.window = {};
  pushSuccessToDataLayer("call-tap", false);
  expect(g.window.dataLayer).toEqual([{ event: "pg_success", success_moment: "call-tap", success_background: false }]);
});

test("on the server it does nothing", () => {
  expect(() => pushSuccessToDataLayer("lead", false)).not.toThrow();
});
