import { describe, expect, it } from "vitest";
import type { PortalEstimate } from "./home";
import { addressChips, groupEstimates, relativeDay } from "./homeList";

const TODAY = "2026-10-26";

function est(over: Partial<PortalEstimate>): PortalEstimate {
  return {
    id: over.id ?? "e1", title: "12 Acacia Street", status: "sent", source: "customer_intake",
    total_cents: null, share_token: "tok", sent_at: "2026-10-20T02:00:00Z", created_at: "2026-10-19T02:00:00Z",
    updated_at: "2026-10-24T02:00:00Z", property_id: "p1", ...over,
  };
}

describe("relativeDay — Melbourne calendar days", () => {
  it("buckets today, yesterday, days, weeks, then the date", () => {
    expect(relativeDay("2026-10-26T00:30:00Z", TODAY)).toBe("today");       // 11:30 Melbourne
    expect(relativeDay("2026-10-25T10:00:00Z", TODAY)).toBe("yesterday");
    expect(relativeDay("2026-10-24T02:00:00Z", TODAY)).toBe("2 days ago");
    expect(relativeDay("2026-10-12T02:00:00Z", TODAY)).toBe("2 weeks ago");
    expect(relativeDay("2026-09-16T02:00:00Z", TODAY)).toBe("on 16 Sep");
    expect(relativeDay("2025-09-16T02:00:00Z", TODAY)).toBe("on 16 Sep 2025");
  });
  it("an instant late in the UTC day is already tomorrow in Melbourne", () => {
    // 2026-10-25 14:30Z is 01:30 on the 26th in Melbourne (+11) — today, not yesterday.
    expect(relativeDay("2026-10-25T14:30:00Z", TODAY)).toBe("today");
  });
  it("nothing for a missing date", () => expect(relativeDay(null, TODAY)).toBeNull());
});

describe("groupEstimates — Needs you / With us / Done", () => {
  it("sorts each state into its group, newest first, with a next step and a date on every card", () => {
    const g = groupEstimates(
      [
        est({ id: "sent-old", status: "sent", updated_at: "2026-10-10T02:00:00Z" }),
        est({ id: "staff-draft", status: "draft", source: "manual", share_token: null, sent_at: null }),
        est({ id: "shaping", status: "draft", source: "customer_intake", updated_at: "2026-10-25T02:00:00Z" }),
        est({ id: "sent-new", status: "sent", updated_at: "2026-10-26T01:00:00Z" }),
        est({ id: "accepted", status: "accepted" }),
        est({ id: "declined", status: "declined" }),
        est({ id: "hist", status: "accepted", source: "airtable", sent_at: "2024-03-01T00:00:00Z" }),
      ],
      [{ estimate_id: "accepted", stage: "closed", start_date: null, end_date: null }],
      { pageLabel: "Condition", where: "13 Lemongrass Cct", lastSeen: "2026-10-19T02:00:00Z" },
      TODAY,
    );
    expect(g.needsYou.map((c) => c.key)).toEqual(["wizard", "sent-new", "shaping", "sent-old"]);
    expect(g.withUs.map((c) => c.key)).toEqual(["staff-draft"]);
    expect(g.done.map((c) => c.key)).toEqual(["accepted", "declined", "hist"]);

    const wizard = g.needsYou[0];
    expect(wizard.chip.label).toBe("Not yet submitted");
    expect(wizard.next).toBe("You were at Condition — tap to finish it");
    expect(wizard.when).toBe("Started 1 week ago");
    expect(wizard.href).toBe("/estimate");

    expect(g.needsYou[1].when).toBe("Updated today");
    expect(g.needsYou[1].href).toBe("/e/tok?portal=1");
    expect(g.needsYou[2].chip.label).toBe("Keep shaping");
    expect(g.needsYou[2].href).toBe("/estimate/scope?id=shaping");

    const checking = g.withUs[0];
    expect(checking.chip.label).toBe("Being checked");
    expect(checking.next).toMatch(/within one business day/);
    expect(checking.href).toBeNull();

    expect(g.done[0].chip.label).toBe("Complete");
    expect(g.done[0].next).toMatch(/Signed off/);
    expect(g.done[2].testId).toBe("portal-history");
    expect(g.done[2].next).toBe("From our records · Mar 2024");
    for (const c of [...g.needsYou, ...g.withUs]) expect(c.when).toBeTruthy();
  });

  it("tags Paint Home jobs only on a mixed account", () => {
    const rows = [est({ id: "ph", brand: "painthome" })];
    expect(groupEstimates(rows, [], null, TODAY, false).needsYou[0].paintHome).toBe(false);
    expect(groupEstimates(rows, [], null, TODAY, true).needsYou[0].paintHome).toBe(true);
  });
});

describe("addressChips — dedupe, cap, expand", () => {
  const props = [
    { id: "a1", account_id: "x", address: "13 Leamington Crescent", suburb: "Caulfield", postcode: "3162" },
    { id: "a2", account_id: "x", address: "13 Leamington Crescent", suburb: "Caulfield", postcode: "3162" },
    { id: "a3", account_id: "x", address: "13 leamington  crescent", suburb: "Caulfield", postcode: "3162" },
    { id: "b", account_id: "x", address: "2 Beech Rise", suburb: "Ringwood", postcode: "3134" },
    { id: "c", account_id: "x", address: "288 Bluff Rd", suburb: "Sandringham", postcode: "3191" },
    { id: "d", account_id: "x", address: "1/41 Devoy St", suburb: "Ashwood", postcode: "3147" },
    { id: "e", account_id: "x", address: "53B Talbot Cres", suburb: "Kooyong", postcode: "3144" },
    { id: "f", account_id: "x", address: "1330 Ferntree Gully Rd", suburb: "Scoresby", postcode: "3179" },
  ];
  const rows = [
    est({ id: "1", property_id: "a1", updated_at: "2026-10-01T00:00:00Z" }),
    est({ id: "2", property_id: "a2", updated_at: "2026-10-02T00:00:00Z" }),
    est({ id: "3", property_id: "a3", updated_at: "2026-10-03T00:00:00Z" }),
    est({ id: "4", property_id: "d", updated_at: "2026-10-25T00:00:00Z" }),
    est({ id: "5", property_id: "b", updated_at: "2026-10-20T00:00:00Z" }),
    est({ id: "6", property_id: "c", updated_at: "2026-10-18T00:00:00Z" }),
    est({ id: "7", property_id: "e", updated_at: "2026-10-05T00:00:00Z" }),
  ];

  it("identical addresses are one chip with a count; the four most active lead; the rest are hidden", () => {
    const s = addressChips(props, rows, null, false);
    expect(s.shown.map((c) => c.label)).toEqual(["1/41 Devoy St", "2 Beech Rise", "288 Bluff Rd", "53B Talbot Cres"]);
    expect(s.hidden.map((c) => c.label)).toEqual(["13 Leamington Crescent", "1330 Ferntree Gully Rd"]);
    const leam = s.hidden[0];
    expect(leam.ids).toEqual(["a1", "a2", "a3"]);
    expect(leam.count).toBe(3);
    expect(s.selectedIds).toBeNull();
  });

  it("a selected hidden chip is pulled into view and selects every merged id", () => {
    const s = addressChips(props, rows, "a2", false);
    expect(s.shown.map((c) => c.label)).toContain("13 Leamington Crescent");
    expect(s.shown).toHaveLength(4);
    expect(s.selectedIds).toEqual(["a1", "a2", "a3"]);
  });

  it("expanded shows everything and hides nothing", () => {
    const s = addressChips(props, rows, null, true);
    expect(s.shown).toHaveLength(6);
    expect(s.hidden).toHaveLength(0);
  });
});
