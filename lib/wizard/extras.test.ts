import { describe, expect, it } from "vitest";
import { EXTRA_NOTE_MAX, extraNoteDeferral, jobExtras } from "./extras";

const card = [
  { code: "Walls", category: "Interior", sub_category: "Walls", charge_out_cents: 8500 },
  { code: "Ceilings", category: "Interior", sub_category: "Ceilings", charge_out_cents: 8500 },
  { code: "Air Vent", category: "Interior", sub_category: "Extras", charge_out_cents: 4500 },
  { code: "Ceiling Rose", category: "Interior", sub_category: "Extras", charge_out_cents: 12000 },
  { code: "Mould Treatment", category: "Interior", sub_category: "Extras", charge_out_cents: 9000 },
  // Another control owns these — they must never reach the sheet.
  { code: "Robe Door", category: "Interior", sub_category: "Extras", charge_out_cents: 5000 },
  { code: "Plastering", category: "Interior", sub_category: "Allowances", charge_out_cents: 8500 },
  // No charge-out: cannot be presented as a price, so it is not offered.
  { code: "Mystery Item", category: "Interior", sub_category: "Extras", charge_out_cents: 0 },
  { code: "Weatherboards", category: "Exterior", sub_category: "Cladding", charge_out_cents: 8500 },
];

describe("the sheet is derived from the card, never hardcoded", () => {
  it("offers the card's own extras, priced at its charge-out", () => {
    const out = jobExtras(card);
    const codes = out.map((e) => e.code).sort();
    expect(codes).toContain("Ceiling Rose");
    expect(codes).toContain("Mould Treatment");
    expect(out.find((e) => e.code === "Ceiling Rose")?.priceDollars).toBe(120);
  });

  /** A tick that cannot price is a lie — the add panel's rule, kept. */
  it("drops a row with no charge-out rather than showing it at nothing", () => {
    expect(jobExtras(card).map((e) => e.code)).not.toContain("Mystery Item");
  });

  it("never offers what another control owns", () => {
    const codes = jobExtras(card).map((e) => e.code);
    expect(codes).not.toContain("Robe Door");   // the cupboard question
    expect(codes).not.toContain("Plastering");  // an estimator's allowance
  });

  it("never offers a surface the room card owns", () => {
    const codes = jobExtras(card).map((e) => e.code);
    expect(codes).not.toContain("Walls");
    expect(codes).not.toContain("Ceilings");
  });

  it("never offers an exterior row on the interior sheet", () => {
    expect(jobExtras(card).map((e) => e.code)).not.toContain("Weatherboards");
  });

  it("offers nothing at all when the card has no extras", () => {
    expect(jobExtras([{ code: "Walls", category: "Interior", sub_category: "Walls", charge_out_cents: 8500 }])).toEqual([]);
  });
});

describe("an unusual extra is flagged, never priced", () => {
  it("says plainly that it is not priced", () => {
    const d = extraNoteDeferral("  a mural in the hallway  ")!;
    expect(d.needs).toContain("NOT priced");
    expect(d.needs).toContain("a mural in the hallway");
  });

  it("ignores an empty note", () => {
    expect(extraNoteDeferral("   ")).toBeNull();
    expect(extraNoteDeferral("")).toBeNull();
  });

  it("clamps a very long note", () => {
    const d = extraNoteDeferral("x".repeat(EXTRA_NOTE_MAX + 200))!;
    expect(d.needs.length).toBeLessThan(EXTRA_NOTE_MAX + 200);
  });
});
