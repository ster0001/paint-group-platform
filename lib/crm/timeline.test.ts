import { describe, expect, it } from "vitest";
import { CRM_EVENT_TYPES } from "./events";
import { buildTimeline, timelineStamp } from "./timeline";

const ev = (over: Partial<Parameters<typeof buildTimeline>[0][number]> = {}) => ({
  id: "e1",
  type: "note_added",
  payload: { body: "called back" } as Record<string, unknown>,
  occurred_at: "2026-08-26T06:30:00.000Z",
  source: "staff",
  ...over,
});

describe("buildTimeline", () => {
  it("renders every catalogued type — no event can land with no label", () => {
    // The gap this closes: an event written by a new feature that shows up in
    // the timeline as a blank row, which reads as "nothing happened".
    const rows = buildTimeline(CRM_EVENT_TYPES.map((t, i) => ev({ id: `e${i}`, type: t, payload: {} })));
    expect(rows).toHaveLength(CRM_EVENT_TYPES.length);
    expect(rows.filter((r) => !r.label.trim())).toEqual([]);
  });

  it("puts the newest first, whatever order the rows arrive in", () => {
    const rows = buildTimeline([
      ev({ id: "old", occurred_at: "2026-08-20T01:00:00.000Z" }),
      ev({ id: "new", occurred_at: "2026-08-28T01:00:00.000Z" }),
      ev({ id: "mid", occurred_at: "2026-08-24T01:00:00.000Z" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("writes the mockup's wording for the rows it shows", () => {
    const [sent] = buildTimeline([ev({
      type: "estimate_sent",
      payload: { totalCents: 842000, channel: "both", validDays: 60 },
    })]);
    expect(sent.label).toBe("Estimate sent");
    expect(sent.detail).toBe("$8,420 inc. GST · SMS + email · valid 60 days");

    const [called] = buildTimeline([ev({ type: "call_no_answer", payload: { voicemail: false } })]);
    expect(called.label).toBe("Called — no answer");
    expect(called.detail).toBe("No voicemail left");

    const [opened] = buildTimeline([ev({
      type: "estimate_viewed", payload: { viewNumber: 3, secondsOnPage: 360 },
    })]);
    expect(opened.label).toBe("Estimate opened");
    expect(opened.detail).toBe("Third time. 6 minutes on the page.");
  });

  it("groups rows by who caused them, which is how the mockup tints them", () => {
    const rows = buildTimeline([
      ev({ id: "a", type: "note_added", payload: { body: "x" } }),
      ev({ id: "b", type: "estimate_viewed", payload: {} }),
      ev({ id: "c", type: "invoice_paid", payload: { amountCents: 100 } }),
      ev({ id: "d", type: "campaign_message_sent", payload: { campaignKey: "warranty", step: 1, channel: "email" } }),
    ]);
    expect(rows.map((r) => `${r.id}:${r.kind}`).sort())
      .toEqual(["a:activity", "b:customer", "c:system", "d:campaign"]);
  });

  it("shows an unknown type as itself rather than dropping the row", () => {
    // A vanished row makes the timeline quietly wrong, which is worse than an
    // ugly one — this is the case where a new writer ships before its label.
    const [row] = buildTimeline([ev({ type: "site_photos_captured", payload: { count: 9 } })]);
    expect(row.label).toBe("Site photos captured");
    expect(row.detail).toBe("");
  });

  it("survives a malformed payload instead of breaking the page", () => {
    const [row] = buildTimeline([ev({ type: "estimate_sent", payload: null })]);
    expect(row.label).toBe("Estimate sent");
    expect(row.detail).toBe("");
  });

  it("keeps a note's own words as its detail", () => {
    const [row] = buildTimeline([ev({ payload: { body: "Wants it finished before her parents visit in October." } })]);
    expect(row.label).toBe("Note");
    expect(row.detail).toBe("Wants it finished before her parents visit in October.");
  });
});

describe("timelineStamp", () => {
  const now = new Date("2026-08-28T22:42:00+10:00");

  it("uses the mockup's three forms", () => {
    expect(timelineStamp("2026-08-28T08:42:00+10:00", now)).toBe("Today 08:42");
    expect(timelineStamp("2026-08-27T20:15:00+10:00", now)).toBe("Yest 20:15");
    expect(timelineStamp("2026-08-26T16:30:00+10:00", now)).toBe("26 Aug 16:30");
  });

  it("says nothing rather than 'Invalid Date' when the input is junk", () => {
    expect(timelineStamp("not a date", now)).toBe("");
  });
});
