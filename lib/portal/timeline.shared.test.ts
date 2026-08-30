import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import { buildTimeline, type TimelineInput } from "./timeline";

/**
 * Trade portal v2 · Session 4 — the never-fork proof.
 *
 * 1 · Identical wo_events-derived input renders identical timeline output
 *     whether the caller is the residential page (no tradeEvents key) or
 *     the trade route with nothing extra to add — pinned by snapshot.
 * 2 · Trade extras ride the SAME feed: residential items survive unchanged,
 *     in order, with the extras interleaved by time like any other event.
 * 3 · Both route files import the one shared JobTimeline component — the
 *     markup exists in exactly one place.
 */

const INPUT: Omit<TimelineInput, "tradeEvents"> = {
  surfaces: [
    { heading: "Living room", label: "Walls", state: "done", sort: 0 },
    { heading: "Living room", label: "Ceiling", state: "prepped", sort: 1 },
  ],
  updates: [{ for_date: "2026-08-29", text: "First coat on in the bedrooms.", sent_at: "2026-08-29T07:00:00Z" }],
  photos: [
    { id: "ph1", kind: "before", area: "Living room", caption: "", created_at: "2026-08-27T21:00:00Z" },
    { id: "ph2", kind: "progress", area: "Living room", caption: "First coat", created_at: "2026-08-29T03:00:00Z" },
  ],
  variations: [{
    id: "v1", status: "customer_approved", category: "rot", comment: "Laundry sill",
    price_cents: 18000, customer_token: "tok", customer_responded_at: "2026-08-28T01:20:00Z",
    created_at: "2026-08-28T00:00:00Z",
  }],
  underwayAt: "2026-08-27T21:15:00Z",
  readyAt: null,
  qaPassedAt: null,
  walkthroughFor: null,
  signedAt: null,
  depositPaidOn: "2026-08-22",
  depositCents: 69300,
  todayYmd: "2026-08-30",
};

test("SNAPSHOT: residential and trade callers produce identical output for the same input", () => {
  const residential = buildTimeline({ ...INPUT });
  const tradeNoExtras = buildTimeline({ ...INPUT, tradeEvents: [] });
  expect(tradeNoExtras).toEqual(residential);
  expect(residential).toMatchSnapshot();
});

test("trade extras interleave by time without disturbing the residential items", () => {
  const residential = buildTimeline({ ...INPUT });
  const withExtras = buildTimeline({
    ...INPUT,
    tradeEvents: [{
      key: "trade:colours", at: "2026-08-26T05:00:00Z",
      title: "Colours confirmed & paint ordered", body: "The colour schedule is locked in.",
      chip: null, photoIds: [], cta: null, amountCents: null,
    }, {
      key: "trade:painter", at: "2026-08-24T05:00:00Z",
      title: "Painter confirmed", body: "Marco accepted the booking.",
      chip: null, photoIds: [], cta: null, amountCents: null,
    }],
  });
  expect(withExtras.filter((i) => !i.key.startsWith("trade:"))).toEqual(residential);
  const keys = withExtras.map((i) => i.key);
  // Newest-first feed: the pre-start extras land after the on-site items.
  expect(keys.indexOf("trade:colours")).toBeGreaterThan(keys.indexOf("update:2026-08-29"));
  // Painter confirmed (24 Aug) sits between colours (26 Aug) and the
  // deposit (22 Aug) — interleaved by time like any other event.
  expect(keys.indexOf("trade:painter")).toBeGreaterThan(keys.indexOf("trade:colours"));
  expect(keys.indexOf("trade:painter")).toBeLessThan(keys.indexOf("deposit"));
});

test("one import location: both portals render app/account/(portal)/JobTimeline", () => {
  const residentialPage = readFileSync("app/account/(portal)/project/page.tsx", "utf8");
  const tradePage = readFileSync("app/account/(portal)/properties/[id]/jobs/[woId]/page.tsx", "utf8");
  expect(residentialPage).toMatch(/import JobTimeline from "\.\.\/JobTimeline"/);
  expect(tradePage).toMatch(/import JobTimeline from "\.\.\/\.\.\/\.\.\/\.\.\/JobTimeline"/);
  // And nobody re-declares the feed: the day-by-day markup lives once.
  expect(residentialPage).not.toMatch(/tl-item/);
  expect(tradePage).not.toMatch(/tl-item/);
});
