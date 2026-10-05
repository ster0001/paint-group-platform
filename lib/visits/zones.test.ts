import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPoint, pointInPolygon, type ZoneCollection } from "./zoneGeo";
import { normalisePostcode, normaliseSuburb, resolveFromList, type SuburbRow } from "./zones";

/**
 * Visit zones — S1 "done when" (addendum A §7, S1), driven over the review CSV
 * the seed script writes, so what the test proves is exactly what the seed
 * puts in `visit_suburbs`.
 */

const DATA = resolve(__dirname, "../../docs/briefs/data");

function csv(path: string): Array<Record<string, string>> {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const parse = (line: string) => {
    const out: string[] = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
    }
    out.push(cur); return out;
  };
  const header = parse(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(header.map((h, i) => [h, parse(l)[i] ?? ""])));
}

const review = csv(resolve(DATA, "visit-zones-review.csv"));
const rulings = csv(resolve(DATA, "visit-zones-suburb-rulings.csv"));
const zones = JSON.parse(readFileSync(resolve(DATA, "visit-zones-draft2.geojson"), "utf8")) as ZoneCollection;

/** The seed, as the resolver would read it back. */
const LIST: SuburbRow[] = review.map((r, i) => ({
  id: `row-${i}`, suburb: r.suburb, postcode: r.postcode, status: r.proposed_status as SuburbRow["status"],
  far_edge: r.far_edge === "true", reviewed: r.reviewed === "true", basis: r.basis, lat: Number(r.lat), lng: Number(r.lng),
}));

const byName = (s: string) => LIST.filter((r) => normaliseSuburb(r.suburb) === normaliseSuburb(s));
const pcOf = (s: string) => byName(s)[0]?.postcode ?? "";
const resolve1 = (suburb: string, postcode = pcOf(suburb)) => resolveFromList(LIST, { suburb, postcode });

describe("S1 — every suburb in the rulings CSV resolves to its expected_status", () => {
  it("210 rulings, 210 matches", () => {
    expect(rulings.length).toBe(210);
    const wrong: string[] = [];
    for (const rule of rulings) {
      const rows = byName(rule.suburb);
      expect(rows.length, `${rule.suburb} is in the seed`).toBeGreaterThan(0);
      // A name with several postcodes: the ruling applies to the metro one(s),
      // and at least one of them must resolve to the ruled status.
      const ok = rows.some((r) => resolveFromList(LIST, { suburb: rule.suburb, postcode: r.postcode }).outcome === rule.expected_status);
      if (!ok) wrong.push(`${rule.suburb} → ${rows.map((r) => `${r.postcode}=${r.status}`).join(",")} (expected ${rule.expected_status})`);
    }
    expect(wrong).toEqual([]);
  });

  it("far-edge ticks come from the CSV's far_edge column (R18)", () => {
    const proposed = rulings.filter((r) => r.far_edge.trim() === "proposed").map((r) => r.suburb);
    expect(proposed.length).toBe(24);
    for (const s of proposed) expect(resolve1(s).farEdge, s).toBe(true);
    expect(resolve1("Glen Waverley").farEdge).toBe(false);
  });
});

describe("S1 — the named checks", () => {
  it("Glen Waverley 3150 is Zone 1 and Wheelers Hill 3150 is Zone 3", () => {
    expect(resolve1("Glen Waverley", "3150").outcome).toBe("zone_1");
    expect(resolve1("Wheelers Hill", "3150").outcome).toBe("zone_3");
  });
  it("Parkdale 3195 is Zone 1 and Mordialloc 3195 is Zone 4", () => {
    expect(resolve1("Parkdale", "3195").outcome).toBe("zone_1");
    expect(resolve1("Mordialloc", "3195").outcome).toBe("zone_4");
  });
  it("Greensborough, Bundoora, Werribee and Tarneit are out of area", () => {
    for (const s of ["Greensborough", "Bundoora", "Werribee", "Tarneit"]) expect(resolve1(s).outcome, s).toBe("out_of_area");
  });
  it("Thomastown, Eltham, Cranbourne, Pakenham, Officer and Clyde are pre-arranged", () => {
    for (const s of ["Thomastown", "Eltham", "Cranbourne", "Pakenham", "Officer", "Clyde"]) expect(resolve1(s).outcome, s).toBe("pre_arranged");
  });
  it("Lynbrook, Langwarrin and Baxter are Zone 4", () => {
    for (const s of ["Lynbrook", "Langwarrin", "Baxter"]) expect(resolve1(s).outcome, s).toBe("zone_4");
  });
  it("a made-up Victorian suburb is unmapped (the caller records it for the work queue)", () => {
    const r = resolveFromList(LIST, { suburb: "Paintbrush Flats", postcode: "3999" });
    expect(r.outcome).toBe("unmapped");
    expect(r.basis).toBe("unmapped");
  });
  it("another state is out of area, not unmapped", () => {
    expect(resolveFromList(LIST, { suburb: "Bondi", postcode: "2026", state: "NSW" }).outcome).toBe("out_of_area");
  });
});

describe("resolveFromList — the postcode rule", () => {
  it("a shared postcode is told apart by the suburb; a wrong postcode on a unique name still matches by name", () => {
    expect(resolveFromList(LIST, { suburb: "Wheelers Hill", postcode: "3150" }).basis).toBe("suburb_and_postcode");
    const typo = resolveFromList(LIST, { suburb: "Werribee", postcode: "3031" });
    expect(typo.outcome).toBe("out_of_area");
    expect(typo.basis).toBe("suburb_only_unique");
  });
  it("a name carried by two postcodes with neither postcode given is unmapped — the postcode is the only tell", () => {
    const two: SuburbRow[] = [
      { id: "a", suburb: "Twin", postcode: "3001", status: "zone_1", far_edge: false, reviewed: true, basis: "t", lat: null, lng: null },
      { id: "b", suburb: "Twin", postcode: "3002", status: "zone_3", far_edge: false, reviewed: true, basis: "t", lat: null, lng: null },
    ];
    expect(resolveFromList(two, { suburb: "Twin", postcode: "" }).outcome).toBe("unmapped");
    expect(resolveFromList(two, { suburb: "Twin", postcode: "3002" }).outcome).toBe("zone_3");
  });
  it("names and postcodes are normalised", () => {
    expect(normaliseSuburb("  glen   WAVERLEY ")).toBe("glen waverley");
    expect(normalisePostcode("VIC 3150")).toBe("3150");
    expect(normalisePostcode("")).toBe("");
    expect(resolveFromList(LIST, { suburb: " GLEN  waverley", postcode: "VIC 3150" }).outcome).toBe("zone_1");
  });
});

describe("the outline test (seed step 2)", () => {
  it("features are tested in ascending priority and the first hit wins", () => {
    const gw = byName("Glen Waverley")[0], wh = byName("Wheelers Hill")[0];
    expect(classifyPoint([gw.lng!, gw.lat!], zones).status).toBe("zone_1");
    expect(classifyPoint([wh.lng!, wh.lat!], zones).status).toBe("zone_3");
    const so = byName("Sorrento")[0];
    expect(classifyPoint([so.lng!, so.lat!], zones)).toEqual({ status: "pre_arranged", part: "Mount Martha to Portsea" });
    const we = byName("Werribee")[0];
    expect(classifyPoint([we.lng!, we.lat!], zones).status).toBe("out_of_area");
  });
  it("point in polygon handles holes and edges", () => {
    const square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([15, 5], square)).toBe(false);
    expect(pointInPolygon([10, 5], square)).toBe(true);
    const withHole = [...square, [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]];
    expect(pointInPolygon([5, 5], withHole)).toBe(false);
  });
  it("every disagreement between the outline and the CSV is written down, not hidden", () => {
    const dis = review.filter((r) => r.disagreement);
    expect(dis.length).toBeGreaterThan(0);
    for (const r of dis) expect(r.outline_status).not.toBe(r.proposed_status);
    for (const r of review.filter((r) => !r.disagreement && r.reviewed === "true")) expect(r.outline_status).toBe(r.proposed_status);
  });
});
