import { describe, expect, it } from "vitest";
import {
  areaRollups, buildTimeline, dayHeading, melbourneDayOf,
  type TimelineInput, type TimelineSurface, type TimelineVariation,
} from "./timeline";

const TODAY = "2026-08-27";

const base = (over: Partial<TimelineInput> = {}): TimelineInput => ({
  surfaces: [], updates: [], photos: [], variations: [],
  underwayAt: null, readyAt: null, qaPassedAt: null, walkthroughFor: null,
  signedAt: null, depositPaidOn: null, depositCents: null, todayYmd: TODAY,
  ...over,
});

const sf = (heading: string, state: TimelineSurface["state"], sort = 0): TimelineSurface =>
  ({ heading, label: "Walls", state, sort });

describe("areaRollups — customer words only", () => {
  it("maps surface states to the four customer phrases", () => {
    const rollups = areaRollups([
      sf("Hallway", "done", 0), sf("Hallway", "done", 1),
      sf("Lounge", "prepped", 2), sf("Lounge", "todo", 3),
      sf("Kitchen", "todo", 4),
      sf("Bedroom", "done", 5), sf("Bedroom", "todo", 6),
    ]);
    expect(rollups).toEqual([
      { heading: "Hallway", chip: { cls: "emerald", label: "Done ✓" } },
      { heading: "Lounge", chip: { cls: "amber", label: "Being prepped" } },
      { heading: "Kitchen", chip: { cls: "mut", label: "Not started" } },
      { heading: "Bedroom", chip: { cls: "cyan", label: "First coat" } },
    ]);
  });
});

describe("buildTimeline", () => {
  it("sent updates render; the feed is newest first; today's item is live", () => {
    const items = buildTimeline(base({
      updates: [
        { for_date: "2026-08-26", text: "Prep day done.", sent_at: "2026-08-26T06:00:00Z" },
        { for_date: "2026-08-27", text: "First coat on.", sent_at: "2026-08-27T06:00:00Z" },
      ],
    }));
    expect(items.map((i) => i.body)).toEqual(["First coat on.", "Prep day done."]);
    expect(items[0].live).toBe(true);
    expect(items[1].live).toBe(false);
  });

  it("photos ride their day's update card; an update-less day gets a photo card", () => {
    const items = buildTimeline(base({
      updates: [{ for_date: "2026-08-26", text: "Prep day.", sent_at: "2026-08-26T06:00:00Z" }],
      photos: [
        { id: "p1", kind: "progress", area: "Hallway", caption: "", created_at: "2026-08-26T04:00:00Z" },
        { id: "p2", kind: "before", area: "Lounge", caption: "", created_at: "2026-08-25T02:00:00Z" },
      ],
    }));
    const update = items.find((i) => i.key === "update:2026-08-26")!;
    expect(update.photoIds).toEqual(["p1"]);
    const photoCard = items.find((i) => i.key.startsWith("photos:"))!;
    expect(photoCard.photoIds).toEqual(["p2"]);
    expect(photoCard.title).toMatch(/Before photos/);
  });

  it("a QA pass is a friendly milestone — and a fail never renders (caller sends pass only)", () => {
    const items = buildTimeline(base({ qaPassedAt: "2026-08-26T02:00:00Z" }));
    expect(items[0].title).toBe("Quality check passed");
    expect(items[0].body).not.toMatch(/fail|photo|item/i);
  });

  it("variation cards follow the two-sided flow — pending links to /v, decided renders as record", () => {
    const v = (over: Partial<TimelineVariation>): TimelineVariation => ({
      id: over.id ?? "v1", status: "priced", category: "rot", comment: "Sill rot",
      price_cents: 34_000, customer_token: "vtok", customer_responded_at: null,
      created_at: "2026-08-26T03:00:00Z", ...over,
    });
    const items = buildTimeline(base({
      variations: [
        v({}),
        v({ id: "v2", status: "customer_approved", customer_responded_at: "2026-08-26T05:00:00Z" }),
        v({ id: "v3", status: "declined", customer_responded_at: "2026-08-26T06:00:00Z" }),
        v({ id: "v4", status: "raised", price_cents: null, customer_token: null }),
        // Internal approval (office pays the painter, client never sees it —
        // Tom, 1 Sep): approved with no token, must render NOTHING.
        v({ id: "v5", status: "customer_approved", price_cents: 0, customer_token: null,
            customer_responded_at: "2026-08-26T07:00:00Z" }),
      ],
    }));
    const pending = items.find((i) => i.key === "variation:v1")!;
    expect(pending.cta).toEqual({ label: "Review & approve", href: "/v/vtok" });
    expect(pending.chip?.label).toBe("Waiting on you");
    expect(pending.body).toContain("$340.00");
    expect(items.find((i) => i.key === "variation:v2")!.title).toBe("You approved an extra");
    expect(items.find((i) => i.key === "variation:v3")!.title).toBe("You said no thanks");
    // Tom, 1 Sep: a raised variation says nothing to the customer — they hear
    // when it's priced FOR THEM (or never, if the office absorbs it).
    expect(items.find((i) => i.key === "variation:v4")).toBeUndefined();
    expect(items.find((i) => i.key === "variation:v5")).toBeUndefined();
  });

  it("milestones carry the money and the plain words", () => {
    const items = buildTimeline(base({
      depositPaidOn: "2026-08-13", depositCents: 253_500,
      underwayAt: "2026-08-19T00:00:00Z",
      signedAt: "2026-08-27T05:00:00Z",
    }));
    expect(items.map((i) => i.key)).toEqual(["signed", "underway", "deposit"]);
    expect(items.find((i) => i.key === "deposit")!.amountCents).toBe(253_500);
  });
});

describe("day helpers", () => {
  it("melbourneDayOf buckets by Melbourne calendar day, not UTC", () => {
    // 23:00 UTC on the 26th is already the 27th in Melbourne (AEST +10).
    expect(melbourneDayOf("2026-08-26T23:00:00Z")).toBe("2026-08-27");
  });
  it("dayHeading marks today", () => {
    expect(dayHeading("2026-08-27", TODAY)).toMatch(/^Today · Thursday 27 August$/);
    expect(dayHeading("2026-08-26", TODAY)).toBe("Wednesday 26 August");
  });
});
