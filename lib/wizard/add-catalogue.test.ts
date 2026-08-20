import { describe, expect, test } from "vitest";
import { exteriorAddOptions, interiorAddOptions, perItemChargeOut } from "./add-catalogue";

/**
 * R5: the add panel is derived from the rate card. These guard the two ways
 * that can go wrong — offering something another control owns, and pinning a
 * charge-out that should have come from the category.
 */

const CARD = [
  // Interior — the live card's shape as at 20 Aug 2026.
  { code: "Walls", category: "Interior", sub_category: "Walls", unit: "M2", charge_out_cents: 8500 },
  { code: "Ceilings", category: "Interior", sub_category: "Ceilings", unit: "M2", charge_out_cents: 8500 },
  { code: "Standard Cornices", category: "Interior", sub_category: "Ceilings", unit: "Lineal Metres", charge_out_cents: 8500 },
  { code: "Skirting Boards", category: "Interior", sub_category: "Interior Trim", unit: "Lineal Metres", charge_out_cents: 8500 },
  { code: "Picture Rails", category: "Interior", sub_category: "Interior Trim", unit: "Lineal Metres", charge_out_cents: 8500 },
  { code: "Flat Door and Frame (1 Side)", category: "Interior", sub_category: "Interior Doors", unit: "Hours Per Item", charge_out_cents: 8500 },
  { code: "Awning / Casement Window", category: "Interior", sub_category: "Interior Windows", unit: "Hours Per Item", charge_out_cents: 8500 },
  { code: "Air Vent", category: "Interior", sub_category: "Extras", unit: "Hours Per Item", charge_out_cents: 18000 },
  { code: "Kitchen Cupboard Front", category: "Interior", sub_category: "Cabinetry", unit: "Hours Per Item", charge_out_cents: 8500 },
  // Exterior
  { code: "Weatherboards", category: "Exterior", sub_category: "Cladding", unit: "M2", charge_out_cents: 10000 },
  { code: "Gutters", category: "Exterior", sub_category: "Exterior Trim", unit: "Lineal Metres", charge_out_cents: 10000 },
  { code: "Meter Box", category: "Exterior", sub_category: "Extras", unit: "Hours Per Item", charge_out_cents: 13000 },
  { code: "Shed", category: "Exterior", sub_category: "Extras", unit: "Hours Per Item", charge_out_cents: 12800 },
  { code: "Access Allowance", category: "Exterior", sub_category: "Allowances", unit: "Hours Per Item", charge_out_cents: 10000 },
];

const keys = (opts: Array<{ key: string }>) => opts.map((o) => o.key);

describe("interiorAddOptions", () => {
  test("offers card rows no substrate tick covers", () => {
    expect(keys(interiorAddOptions(CARD))).toContain("Picture Rails");
  });

  test("never offers a cabinetry row — the cupboard question owns those", () => {
    expect(keys(interiorAddOptions(CARD))).not.toContain("Kitchen Cupboard Front");
  });

  test("never offers a door or window STYLE — the family tiles own those", () => {
    const k = keys(interiorAddOptions(CARD));
    expect(k).not.toContain("Flat Door and Frame (1 Side)");
    expect(k).not.toContain("Awning / Casement Window");
    // ...but the families themselves are offered as substrate ticks.
    expect(k).toContain("doors");
    expect(k).toContain("windows");
  });

  test("offers every interior substrate, not just one room type's rules", () => {
    const k = keys(interiorAddOptions(CARD));
    for (const s of ["walls", "ceilings", "cornices", "skirting"]) expect(k).toContain(s);
  });

  test("never offers a substrate with no rate row behind it", () => {
    // `staircase` has no codes — merge.ts raises a whole-job deferral instead.
    expect(keys(interiorAddOptions(CARD))).not.toContain("staircase");
  });
});

describe("exteriorAddOptions", () => {
  test("offers ordinary exterior trim per side", () => {
    expect(keys(exteriorAddOptions(CARD))).toContain("Gutters");
  });

  test("never offers cladding — the wall %-mix control owns it", () => {
    expect(keys(exteriorAddOptions(CARD))).not.toContain("Weatherboards");
  });

  test("never offers whole-job items or allowances on one side", () => {
    const k = keys(exteriorAddOptions(CARD));
    expect(k).not.toContain("Shed");            // the sweep owns it
    expect(k).not.toContain("Access Allowance"); // ours to judge, not theirs
  });

  test("never offers an Interior row on an exterior side", () => {
    expect(keys(exteriorAddOptions(CARD))).not.toContain("Picture Rails");
  });
});

describe("perItemChargeOut", () => {
  test("pins a row that carries its own rate (Air Vent $180/h)", () => {
    expect(perItemChargeOut(CARD, "Interior", "Air Vent")).toBe(180);
    expect(perItemChargeOut(CARD, "Exterior", "Meter Box")).toBe(130);
  });

  test("does NOT pin an ordinary row — that would override a staff hourly rate", () => {
    expect(perItemChargeOut(CARD, "Interior", "Picture Rails")).toBeNull();
    expect(perItemChargeOut(CARD, "Exterior", "Gutters")).toBeNull();
  });

  test("an unknown code pins nothing", () => {
    expect(perItemChargeOut(CARD, "Interior", "Gold Leaf")).toBeNull();
  });
});
