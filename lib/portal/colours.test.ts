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

import { byColour, describeProduct, displayCode, longDay, swatchLetter } from "./colours";

describe("My colours (portal UX brief E1–E3) — brand · line · finish, no leaked ids, grouped by colour", () => {
  it("reads brand, line and finish off the product name without inventing anything", () => {
    expect(describeProduct("Dulux Wash&Wear Low Sheen")).toEqual({ brand: "Dulux", line: "Wash&Wear", finish: "low sheen" });
    expect(describeProduct("Dulux Aquanamel Semi-Gloss")).toEqual({ brand: "Dulux", line: "Aquanamel", finish: "semi gloss" });
    expect(describeProduct("British Paints Clean & Protect Matt")).toEqual({ brand: "British Paints", line: "Clean & Protect", finish: "matt" });
    expect(describeProduct("Mystery Coat")).toEqual({ brand: "Mystery", line: "Coat", finish: null });
  });

  it("shows a real manufacturer code and hides a hex or an id fragment", () => {
    expect(displayCode("PN1E4", "#F2EFE6")).toBe("PN1E4");
    expect(displayCode("6c15e22d", null)).toBeNull();       // the UUID slice that leaked as CODE
    expect(displayCode("#F2EFE6", "#F2EFE6")).toBeNull();
    expect(displayCode("f2efe6", "#F2EFE6")).toBeNull();
    expect(displayCode("  ", null)).toBeNull();
  });

  it("groups one card per colour with its surfaces and areas, coats as a range", () => {
    const reg = buildRegister(
      [
        { title: "Hallway & stairs", surfaces: [{ label: "Walls", product: "Dulux Wash&Wear Low Sheen", coats: 2 }, { label: "Trim & doors", product: "Dulux Aquanamel Semi-Gloss", coats: 1 }] },
        { title: "Lounge", surfaces: [{ label: "Walls", product: "Dulux Wash&Wear Low Sheen", coats: 1 }, { label: "Ceiling", product: "Dulux Wash&Wear Low Sheen", coats: 2 }] },
      ],
      [
        { product: "Dulux Wash&Wear Low Sheen", colourName: "Natural White", colourHex: "#F2EFE6", colourStatus: "confirmed" },
        { product: "Dulux Aquanamel Semi-Gloss", colourName: "", colourHex: "", colourStatus: "tbc" },
      ],
      { "Dulux Wash&Wear Low Sheen": { match: { code: "PN1E4" } } },
    );
    const groups = byColour(reg);
    expect(groups.map((g) => g.colourName)).toEqual(["Natural White", null]);
    expect(groups[0]).toMatchObject({ brand: "Dulux", line: "Wash&Wear", finish: "low sheen", code: "PN1E4", coats: "1–2 coats" });
    expect(groups[0].surfaces).toEqual([
      { surface: "Walls", areas: ["Hallway & stairs", "Lounge"] },
      { surface: "Ceiling", areas: ["Lounge"] },
    ]);
    expect(groups[1]).toMatchObject({ colourName: null, line: "Aquanamel", finish: "semi gloss", coats: "1 coat", code: null });
  });

  it("the swatch letter and the applied-by date", () => {
    expect(swatchLetter("natural white")).toBe("N");
    expect(swatchLetter(null)).toBe("?");
    expect(longDay("2026-09-17")).toBe("17 Sep 2026");
    expect(longDay(null)).toBeNull();
  });
});
