import { test, expect } from "vitest";
import { MARKETING_EVENT_NAMES, scrubProps } from "./analytics";

test("the address leaves with see_price only", () => {
  expect(scrubProps("see_price", { where: "hero", mode: "home", address: "12 Elm St" })).toEqual({ where: "hero", mode: "home", address: "12 Elm St" });
  expect(scrubProps("address_typed", { where: "hero", address: "12 Elm St" })).toEqual({ where: "hero" });
  expect(scrubProps("job_get_price", { slug: "x", address: "12 Elm St", mode: "home" })).toEqual({ slug: "x", mode: "home" });
});

test("the brief's event list is complete and every name fits the CRM type shape", () => {
  for (const n of ["nav_cta", "address_typed", "address_selected", "see_price", "mode_home", "mode_business", "ghost_stopped", "job_card",
    "promise_0", "promise_1", "promise_2", "promise_3", "progress_story_start", "progress_story_complete", "progress_story_replay",
    "painter_card", "trade_walkthrough", "trade_account", "faq_open", "call_tap"]) {
    expect(MARKETING_EVENT_NAMES).toContain(n);
  }
  for (const n of MARKETING_EVENT_NAMES) expect(n).toMatch(/^[a-z][a-z0-9_]{2,40}$/);
});
