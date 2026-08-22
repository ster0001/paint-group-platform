import { describe, expect, it } from "vitest";
import { crewDoc } from "./crew";
import type { WorkOrderDoc } from "./snapshot";

/**
 * The crew document leaks nothing. Walked recursively rather than spot-checked,
 * the same instinct as the e2e leak test: match this codebase's own money
 * vocabulary, not a hand-picked field or two.
 */

const full: WorkOrderDoc = {
  version: 1,
  woRef: "WO-TEST",
  status: "in_progress",
  jobTitle: "Whitfield — Armadale interior",
  jobAddress: "14 Bellair Street, Kensington, VIC, 3031",
  contactFirstName: "Priya",
  contactPhone: "0400 000 000",
  startDate: "2026-09-01",
  accessNotes: "Side gate, dog is friendly",
  crewNotes: "Ceilings first",
  levelOfFinish: "Level 3 — Good",
  finishCode: "PG-3",
  contractorName: "Kovac Painting Pty Ltd",
  contractorPaymentCents: 446_100,
  materials: [{ product: "Weathershield", photoUrl: "", litres: 10, coverageMissing: false, colourName: "Vivid White", colourHex: "#fff", colourStatus: "confirmed" }],
  areas: [{
    id: "front", title: "Front", finishCode: "PG-3", finishOverridden: false, photos: [],
    surfaces: [{ key: "front:0", label: "Walls", coats: 2, product: "Weathershield", prep: "Light sand", hours: 6, status: "not_started" }],
  }],
  exclusions: ["Garage floor"],
  company: { name: "Paint Group", phone: "03 8840 9414", logoUrl: "" },
};

/** Every key path in an object tree, dotted. */
function keyPaths(v: unknown, prefix = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => keyPaths(x, prefix));
  if (v && typeof v === "object") {
    return Object.entries(v).flatMap(([k, x]) => [prefix + k, ...keyPaths(x, prefix + k + ".")]);
  }
  return [];
}

describe("what the crew may see", () => {
  const crew = crewDoc(full);

  it("keeps the scope intact — the crew has to paint the thing", () => {
    expect(crew.areas[0].surfaces[0]).toEqual(full.areas[0].surfaces[0]);
    expect(crew.materials).toEqual(full.materials);
    expect(crew.jobAddress).toBe(full.jobAddress);
    expect(crew.accessNotes).toBe(full.accessNotes);
    expect(crew.crewNotes).toBe(full.crewNotes);
    expect(crew.exclusions).toEqual(full.exclusions);
  });

  it("zeroes the contractor's payment", () => {
    expect(crew.contractorPaymentCents).toBe(0);
  });

  it("drops the customer's phone — site questions go through the contractor", () => {
    expect(crew.contactPhone).toBe("");
    expect(JSON.stringify(crew)).not.toContain("0400");
  });

  it("carries no money value anywhere in the tree", () => {
    // Field NAMES like contractorPaymentCents may exist (zeroed); what must
    // never survive is a real amount.
    expect(JSON.stringify(crew)).not.toContain("446100");
    for (const path of keyPaths(crew)) {
      if (/cents|price|payment|margin|rate/i.test(path)) {
        const val = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], crew);
        if (typeof val === "number") expect(val, path).toBe(0);
      }
    }
  });

  it("is a whitelist: a field added to the snapshot tomorrow does not leak", () => {
    const withExtra = { ...full, secretMarginCents: 123_456 } as WorkOrderDoc;
    expect(JSON.stringify(crewDoc(withExtra))).not.toContain("secretMarginCents");
    expect(JSON.stringify(crewDoc(withExtra))).not.toContain("123456");
  });

  it("still validates as a v1 document, so the shared renderer accepts it", () => {
    expect(crew.version).toBe(1);
  });
});
