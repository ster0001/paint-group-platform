import { test } from "vitest";
import assert from "node:assert/strict";
import { applyExteriorAnswers, type MergedBundle } from "./exteriorAnswers.ts";
import { defaultExterior, defaultWizardState, exteriorSides, exteriorSurfaceKeys, wizardStateSchema, type WizardState } from "./state.ts";

/**
 * Tom, 7 Sep 2026 — the exterior question set: "What are we painting? tick
 * all that apply" (house / fence / floor / deck / shed / wall), what the
 * house is made of, which trims, and WHERE (the full exterior or a side or
 * two). Every answer must land as a line, a skipped side, or a deferral the
 * estimator sees — never a silent $0 and never a price on something the card
 * has no rate for.
 */

const bundle = (): MergedBundle => ({ areas: [], skipped: [], deferred: [], assumedCount: 0 });

const ext = (over: Partial<NonNullable<WizardState["exterior"]>> = {}): WizardState => ({
  ...defaultWizardState(),
  jobType: "exterior",
  exterior: { ...defaultExterior(), condition: "good", noPhotos: true, ...over },
});

const sideOf = (m: MergedBundle, name: RegExp) => m.areas.find((a) => a.type === "Exterior" && name.test(a.name))!;

test("an older saved state (no targets / elements / sides) still parses as 'the whole house'", () => {
  const legacy = { ...defaultWizardState(), jobType: "exterior", exterior: { storeys: "single", substrates: ["render"], painting: { body: true, windowsDoors: true, roofline: true, garage: false }, condition: "good", access: [], accessEquipment: [], noPhotos: true, extras: { deck: false, fence: false, fenceMetres: null, fenceType: "paling", pergola: false, balustrade: false } } };
  const r = wizardStateSchema.safeParse({ ...legacy, customer: null, mode: "internal" });
  assert.equal(r.success, true, JSON.stringify(r.success ? null : r.error.issues));
  if (!r.success) return;
  assert.deepEqual(r.data.exterior?.targets, ["house"]);
  assert.deepEqual(exteriorSides(r.data.exterior!), ["front", "left", "right", "back"]);
  assert.equal(exteriorSurfaceKeys(r.data.exterior!).includes("eaves"), true);
});

test("'Where are we painting?' — a side nobody asked for never reaches the estimate", () => {
  // Tom, 8 Sep 2026: "even though I asked the wizard to only price for the
  // front, left and back, it gave me the right side as an option in the
  // estimate — this shouldn't have been in there." An unticked side used to
  // arrive as an option/exclusion on the quote; it is now not scaffolded at
  // all. (A side the customer OPENS and skips in the confirm loop still shows
  // as NOT PAINTING — that is a decision, and the quote should carry it.)
  const m = bundle();
  let n = 1;
  applyExteriorAnswers(m, ext({ sides: ["front", "left"] }), () => n++, new Set(["weatherboards", "fascias"]));
  const front = sideOf(m, /Front/);
  assert.equal(front.isOption, false);
  assert.equal(m.areas.some((a) => /Rear/.test(a.name)), false, "the back was never asked for");
  assert.equal(m.areas.some((a) => /Right/.test(a.name)), false, "the right side was never asked for");
  assert.equal(m.skipped.some((s) => /Rear/.test(s.name)), true, "it is recorded as skipped, not lost");
  assert.equal(m.deferred.some((d) => /Rear/.test(d.room)), false, "no width-to-measure deferral for a side that isn't in the job");
  assert.equal(m.deferred.some((d) => d.areaId === front.id), true, "the painted side keeps its measurement flag");
});

test("a job with no house in it keeps the four sides as the loop's frame, all NOT PAINTING", () => {
  const m = bundle();
  let n = 1;
  applyExteriorAnswers(m, ext({ targets: ["fence"], extras: { deck: false, fence: true, fenceMetres: null, fenceType: "paling", pergola: false, balustrade: false } }), () => n++, new Set(["weatherboards"]));
  const front = sideOf(m, /Front/);
  assert.equal(front.isOption, true);
  const c = (front as unknown as { customer?: { include: boolean | null; confirmed: boolean } }).customer;
  assert.equal(c?.include, false);
  assert.equal(c?.confirmed, true, "a skipped side counts as answered in the confirm loop");
});

test("cladding 'none' = trims only: the scaffold lays no wall line", () => {
  const m = bundle();
  let n = 1;
  applyExteriorAnswers(m, ext({ substrates: ["none"], painting: { body: false, windowsDoors: true, roofline: true, garage: false } }), () => n++, new Set(["fascias", "gutters", "eaves"]));
  const front = sideOf(m, /Front/);
  assert.equal(front.surfaces.some((s) => /Weatherboards|Render|Brick/.test(s.code)), false);
  assert.equal(front.surfaces.some((s) => s.code === "Fascias"), true);
});

test("cladding 'other' scaffolds a placeholder wall and flags the substrate for the estimator", () => {
  const m = bundle();
  let n = 1;
  applyExteriorAnswers(m, ext({ substrates: ["other"] }), () => n++, new Set(["fascias"]));
  assert.equal(sideOf(m, /Front/).surfaces.some((s) => s.code === "Weatherboards"), true);
  assert.equal(m.deferred.some((d) => d.what === "wall cladding" && /other/.test(d.needs)), true);
});

test("a metal fence is a deferral, never a line priced at the paling rate", () => {
  const m = bundle();
  let n = 1;
  applyExteriorAnswers(m, ext({ targets: ["house", "fence"], extras: { ...defaultExterior().extras, fence: true, fenceType: "metal", fenceMetres: 20 } }), () => n++, new Set(["weatherboards"]));
  assert.equal(m.areas.some((a) => a.surfaces.some((s) => /Fence/.test(s.code))), false);
  const d = m.deferred.find((x) => x.what === "metal fence");
  assert.ok(d);
  assert.match(d!.needs, /20 m/);
});

test("a shed rides the card's Shed row with its cladding noted; a wall gets the cladding rate over an assumed height; floor coatings are the estimator's", () => {
  const m = bundle();
  let n = 1;
  applyExteriorAnswers(m, ext({
    targets: ["house", "shed", "wall", "floor"],
    shed: { substrate: "colorbond" },
    wall: { substrate: "brick", metres: 12 },
    floor: { m2: 40 },
  }), () => n++, new Set(["weatherboards"]));
  const extras = m.areas.find((a) => a.name === "Exterior - Extras")!;
  const shed = extras.surfaces.find((s) => s.code === "Shed")!;
  assert.ok(shed);
  assert.match(shed.internalLabel, /Colorbond/);
  const wall = m.areas.find((a) => a.name === "Exterior - Wall")!;
  assert.equal(wall.L, 12);
  assert.equal(wall.H, 1.8);
  assert.deepEqual(wall.assumedFields, ["H"]);
  assert.equal(wall.surfaces[0].code, "Brick");
  assert.equal(m.deferred.some((d) => d.what === "floor coating" && /40 m²/.test(d.needs)), true);
  assert.equal(m.deferred.some((d) => d.what === "freestanding wall"), true);
});

test("no house at all (fence only): the four sides frame the loop, every one already 'not painting'", () => {
  const m = bundle();
  let n = 1;
  applyExteriorAnswers(m, ext({ targets: ["fence"], extras: { ...defaultExterior().extras, fence: true, fenceMetres: 30 } }), () => n++, new Set(["fence"]));
  const sides = m.areas.filter((a) => /Front|Left|Right|Rear/.test(a.name));
  assert.equal(sides.length, 4);
  assert.equal(sides.every((a) => a.isOption === true), true);
  assert.equal(m.deferred.some((d) => d.kind === "exterior_width" && /Exterior - (Front|Left|Right|Rear)/.test(d.room)), false);
  assert.equal(m.areas.some((a) => a.surfaces.some((s) => s.code === "Paling Fence")), true);
});

test("the surface ticks follow the trims one by one (windows without doors, gutters without eaves)", () => {
  const e = { ...defaultExterior(), elements: { windows: true, doors: false, eaves: false, fascias: true, gutters: true, garage: false } };
  const keys = exteriorSurfaceKeys(e);
  assert.equal(keys.includes("exterior_windows"), true);
  assert.equal(keys.includes("exterior_doors"), false);
  assert.equal(keys.includes("eaves"), false);
  assert.equal(keys.includes("gutters") && keys.includes("downpipes") && keys.includes("fascias"), true);
});
