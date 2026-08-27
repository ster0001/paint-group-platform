import { describe, expect, it } from "vitest";
import { buildRegister, sheenOf, type RegisterMaterial, type RegisterSnapshotArea } from "./colours";

const areas: RegisterSnapshotArea[] = [
  {
    title: "Hallway & stairs",
    surfaces: [
      { label: "Walls", product: "Dulux Wash&Wear Low Sheen", coats: 2 },
      { label: "Trim & doors", product: "Dulux Aquanamel Semi-Gloss", coats: 2 },
    ],
  },
  { title: "Lounge", surfaces: [{ label: "Walls", product: "Dulux Wash&Wear Low Sheen", coats: 2 }] },
  { title: "Outside", surfaces: [] },
];

const materials: RegisterMaterial[] = [
  { product: "Dulux Wash&Wear Low Sheen", colourName: "Natural White", colourHex: "#F2EFE6", colourStatus: "confirmed" },
  { product: "Dulux Aquanamel Semi-Gloss", colourName: "", colourHex: "", colourStatus: "tbc" },
];

describe("buildRegister — the permanent paint register", () => {
  it("confirmed colours carry name + swatch; TBC stays honestly null", () => {
    const reg = buildRegister(areas, materials, null);
    expect(reg[0].rows[0]).toMatchObject({
      surface: "Walls", colourName: "Natural White", colourHex: "#F2EFE6", coats: 2,
    });
    expect(reg[0].rows[1]).toMatchObject({ surface: "Trim & doors", colourName: null, colourHex: null });
  });

  it("painter-supplied match codes ride along from the live map", () => {
    const reg = buildRegister(areas, materials, {
      "Dulux Wash&Wear Low Sheen": { match: { code: "PN1E4", brand: "Dulux" } },
    });
    expect(reg[0].rows[0].code).toBe("PN1E4");
  });

  it("areas without surfaces disappear; every area keeps its own rows", () => {
    const reg = buildRegister(areas, materials, null);
    expect(reg.map((a) => a.title)).toEqual(["Hallway & stairs", "Lounge"]);
  });

  it("the WO's colour-schedule tick confirms named colours the per-product status left as tbc", () => {
    // The Devoy St shape (27 Aug): the snapshot carries the colour name but
    // its status stayed "tbc" because confirmation is the checklist tick now.
    const reg = buildRegister(
      [{ title: "Exterior", surfaces: [{ label: "Gutters", product: "Weathershield", coats: 2 }] }],
      [{ product: "Weathershield", colourName: "Ironstone", colourHex: "#464B52", colourStatus: "tbc" }],
      null,
      true,
    );
    expect(reg[0].rows[0]).toMatchObject({ colourName: "Ironstone", colourHex: "#464B52" });
  });

  it("the tick never invents a colour for a product with no name anywhere", () => {
    const reg = buildRegister(
      [{ title: "A", surfaces: [{ label: "Walls", product: "P", coats: 2 }] }],
      [{ product: "P", colourName: "", colourHex: "", colourStatus: "tbc" }],
      null,
      true,
    );
    expect(reg[0].rows[0].colourName).toBeNull();
  });

  it("a live per-product confirmed status still confirms without the tick", () => {
    const reg = buildRegister(
      [{ title: "A", surfaces: [{ label: "Walls", product: "P", coats: 2 }] }],
      [{ product: "P", colourName: "Ironstone", colourHex: "#464B52", colourStatus: "tbc" }],
      { P: { status: "confirmed" } },
    );
    expect(reg[0].rows[0].colourName).toBe("Ironstone");
  });

  it("an unconfirmed material never invents a colour from the hex alone", () => {
    const reg = buildRegister(
      [{ title: "A", surfaces: [{ label: "Walls", product: "P", coats: 2 }] }],
      [{ product: "P", colourName: "Sneaky", colourHex: "#fff", colourStatus: "tbc" }],
      null,
    );
    expect(reg[0].rows[0].colourName).toBeNull();
  });
});

describe("sheenOf", () => {
  it("reads the finish out of the product name", () => {
    expect(sheenOf("Dulux Wash&Wear Low Sheen")).toBe("LOW SHEEN");
    expect(sheenOf("Aquanamel Semi-Gloss")).toBe("SEMI-GLOSS");
    expect(sheenOf("Mystery Paint")).toBeNull();
  });
});
