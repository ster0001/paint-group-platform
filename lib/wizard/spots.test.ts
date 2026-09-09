import { describe, expect, it } from "vitest";
import {
  AUTO_PRICED, DEFAULT_EXTENT_QTY, ROOM_CONDITION_LABEL, SPOT_EXTENTS, SPOT_TAGS,
  extentQtyFrom, roomConditionDeferred, spotLine, tagByKey, tagsFor,
} from "./spots";
import { defectTypes } from "@/lib/extract/photos";
import type { DefectRate } from "@/lib/capture/commit";

const rates: DefectRate[] = [
  { defect_type: "plaster_cracks", unit: "lin_m", hours_sev1: 0.25, hours_sev2: 0.5, hours_sev3: 1 },
  { defect_type: "holes_dents", unit: "each", hours_sev1: 0.2, hours_sev2: 0.4, hours_sev3: 0.8 },
  { defect_type: "water_damage", unit: "m2", hours_sev1: 0.4, hours_sev2: 0.9, hours_sev3: 1.6 },
];
const room = { id: 7, name: "Hall" };
let id = 100;
const nextId = () => id++;

describe("the tag vocabulary is the platform's, relabelled", () => {
  /**
   * The plan reader's "water_damage" and the customer's "Water mark" must
   * price identically, or the same defect costs two different amounts
   * depending on who spotted it.
   */
  it("maps every tag onto a real defect type", () => {
    const known = new Set<string>(defectTypes);
    for (const tag of SPOT_TAGS) {
      // Wallpaper is the documented exception: work, not a defect.
      if (tag.key === "wallpaper") continue;
      expect(known.has(tag.defectType), `${tag.key} → ${tag.defectType}`).toBe(true);
    }
  });

  it("offers the right tags on each side", () => {
    const interior = tagsFor("interior").map((t) => t.key);
    expect(interior).toContain("crack");
    expect(interior).toContain("water");     // both
    expect(interior).not.toContain("rot");   // exterior only

    const exterior = tagsFor("exterior").map((t) => t.key);
    expect(exterior).toContain("rot");
    expect(exterior).toContain("rust");
    expect(exterior).not.toContain("crack"); // interior plaster
  });

  it("gives every tag a note the painter can act on", () => {
    for (const tag of SPOT_TAGS) expect(tag.crewNote.length).toBeGreaterThan(20);
  });
});

describe("⚑6 — the auto-price boundary", () => {
  it("auto-prices a crack and a nail hole, and nothing else", () => {
    expect([...AUTO_PRICED].sort()).toEqual(["crack", "hole"]);
  });

  it("prices a crack from words alone and raises no review", () => {
    const out = spotLine({ tag: "crack" }, room, rates, nextId)!;
    expect(out.surface.prepHr).toBeCloseTo(0.25 * DEFAULT_EXTENT_QTY.spots, 2);
    expect(out.surface.code).toBe("plaster_cracks");
    expect(out.deferred).toBeNull();
  });

  /**
   * Tom, 9 Sep: *"is that 0.3 per square metre, or 0.3 hours for everything?"*
   * — per square metre. `defectHours` is perUnit × qty.
   *
   * Which exposed the fault this test now guards: extent is HOW MUCH (the
   * quantity), not HOW BAD (the severity column). Passing qty 1 and moving the
   * severity instead priced "most of it" on a whole peeling room at eighteen
   * minutes.
   */
  it("prices by EXTENT as a QUANTITY — perUnit × qty", () => {
    const per = 0.4; // water_damage sev1, per m2
    const spots = spotLine({ tag: "water", extent: "spots", sourceId: "s1" }, room, rates, nextId)!;
    const patches = spotLine({ tag: "water", extent: "patches", sourceId: "s1" }, room, rates, nextId)!;
    const most = spotLine({ tag: "water", extent: "most", sourceId: "s1" }, room, rates, nextId)!;
    expect(spots.surface.prepHr).toBeCloseTo(per * DEFAULT_EXTENT_QTY.spots, 2);
    expect(patches.surface.prepHr).toBeCloseTo(per * DEFAULT_EXTENT_QTY.patches, 2);
    expect(most.surface.prepHr).toBeCloseTo(per * DEFAULT_EXTENT_QTY.most, 2);
    // "Most of it" must cost meaningfully more than a couple of spots — the
    // thing that was silently untrue before.
    expect(most.surface.prepHr).toBeGreaterThan(spots.surface.prepHr * 4);
  });

  /**
   * Severity is HOW BAD per unit, and a customer is never asked it — that is a
   * question for somebody who prices these for a living. It comes from the
   * photo reader, or sits at the honest floor.
   */
  it("takes severity from the photo read, never from the customer", () => {
    const light = spotLine({ tag: "water", extent: "patches", sourceId: "s1" }, room, rates, nextId)!;
    const bad = spotLine({ tag: "water", extent: "patches", severity: 3, sourceId: "s1" }, room, rates, nextId)!;
    expect(light.surface.prepHr).toBeCloseTo(0.4 * DEFAULT_EXTENT_QTY.patches, 2);  // sev1
    expect(bad.surface.prepHr).toBeCloseTo(1.6 * DEFAULT_EXTENT_QTY.patches, 2);    // sev3
  });

  it("treats a missing extent as the safe floor, not the worst case", () => {
    expect(spotLine({ tag: "water", sourceId: "s1" }, room, rates, nextId)!.surface.prepHr)
      .toBeCloseTo(0.4 * DEFAULT_EXTENT_QTY.spots, 2);
  });

  it("takes Tom's quantities from Settings when he sets them", () => {
    const tuned = extentQtyFrom({ most: 20 });
    const out = spotLine({ tag: "water", extent: "most", sourceId: "s1" }, room, rates, nextId, tuned)!;
    expect(out.surface.prepHr).toBeCloseTo(0.4 * 20, 2);
    // …and keeps the shipped floor for anything he has not touched.
    expect(tuned.spots).toBe(DEFAULT_EXTENT_QTY.spots);
  });

  it("ignores a junk quantity rather than pricing it", () => {
    const junk = extentQtyFrom({ spots: 0, patches: -2, most: "lots" });
    expect(junk).toEqual(DEFAULT_EXTENT_QTY);
  });

  it("tells the painter how much was allowed, in the rate's own unit", () => {
    const out = spotLine({ tag: "water", extent: "most", sourceId: "s1" }, room, rates, nextId)!;
    expect(out.surface.crewNote).toContain(`allowed for ${DEFAULT_EXTENT_QTY.most} m²`);
  });

  /**
   * Photos earn a price; words earn an estimator. Extent IS the question for
   * flaking or rot, and a photo is the only thing that settles it — a sentence
   * is a claim, a photo is evidence. Nothing is lost either way: the line is
   * on the job and the work order regardless.
   */
  it("prices a water mark WITH a photo, and sends it for sign-off", () => {
    const out = spotLine({ tag: "water", extent: "patches", sourceId: "src-1" }, room, rates, nextId)!;
    expect(out.surface.prepHr).toBeCloseTo(0.4 * DEFAULT_EXTENT_QTY.patches, 2);
    expect(out.deferred?.what).toContain("confirm the prep");
    expect(out.deferred?.needs).toContain("sign the prep off");
  });

  it("records a water mark WITHOUT a photo but leaves the price to a person", () => {
    const out = spotLine({ tag: "water", extent: "most" }, room, rates, nextId)!;
    expect(out.surface.prepHr).toBe(0);
    expect(out.surface.internalLabel).toContain("to price");
    expect(out.deferred?.needs).toContain("no photo");
    expect(out.deferred?.needs).toContain("most of it");
  });

  it("puts the extent on the line the painter reads", () => {
    const out = spotLine({ tag: "flaking", extent: "most", sourceId: "s1" }, room, rates, nextId)!;
    expect(out.surface.crewNote).toContain("extent: most of it");
  });

  /**
   * The spot is ALWAYS a line, priced or not. A spot that only became an
   * amber note in an estimator's queue would be the free-text box §2.3
   * complains about, wearing a tag.
   */
  it("always pins a line to the room, priced or not", () => {
    for (const tag of SPOT_TAGS) {
      const out = spotLine({ tag: tag.key, extent: "patches" }, room, rates, nextId)!;
      expect(out.surface, tag.key).toBeTruthy();
      expect(out.surface.crewNote, tag.key).toContain("customer flagged");
    }
  });

  /** An auto-priced tag with no rate row must not be silently free. */
  it("raises 'needs pricing' when the rate table has no row for it", () => {
    const out = spotLine({ tag: "crack" }, room, [], nextId)!;
    expect(out.surface.prepHr).toBe(0);
    expect(out.deferred?.what).toContain("repair to price");
    expect(out.deferred?.needs).toContain("seed defect_prep_rates");
  });

  it("scales an auto-priced tag by extent too", () => {
    // This fixture's plaster_cracks sev1 is 0.25 per lineal metre.
    expect(spotLine({ tag: "crack", extent: "most" }, room, rates, nextId)!.surface.prepHr)
      .toBeCloseTo(0.25 * DEFAULT_EXTENT_QTY.most, 2);
  });

  it("carries the customer's own words and notes the photo", () => {
    const out = spotLine({ tag: "mould", note: "  behind the bath  ", sourceId: "s1" }, room, rates, nextId)!;
    expect(out.surface.crewNote).toContain('customer said: "behind the bath"');
    expect(out.surface.crewNote).toContain("photo attached");
  });

  it("refuses a tag it does not know", () => {
    expect(spotLine({ tag: "gremlins" }, room, rates, nextId)).toBeNull();
  });

  it("prices wallpaper at nothing and asks a person, without a rate row", () => {
    const out = spotLine({ tag: "wallpaper" }, room, rates, nextId)!;
    expect(out.surface.prepHr).toBe(0);
    expect(out.deferred).not.toBeNull();
  });
});

describe("per-room condition", () => {
  it("flags only 'worse' for the estimator", () => {
    expect(roomConditionDeferred(room, "same")).toBeNull();
    expect(roomConditionDeferred(room, "better")).toBeNull();
    const worse = roomConditionDeferred(room, "worse")!;
    expect(worse.areaId).toBe(7);
    expect(worse.needs).toContain("prep allowance");
  });

  it("names all three for a person", () => {
    expect(ROOM_CONDITION_LABEL.same).toBe("Same as the rest");
    expect(ROOM_CONDITION_LABEL.worse).toBe("Worse than the rest");
  });
});

describe("labels", () => {
  /**
   * The card reads a spot's name off the LINE (customerRoomView strips
   * "Repair — "), so the customer sees their own word back — they tapped
   * "Crack", they read "Crack". There is deliberately no second naming
   * function here: two ways to name a spot is two ways for them to disagree.
   */
  it("labels the line with the customer's own word", () => {
    const out = spotLine({ tag: "water" }, room, rates, nextId)!;
    expect(out.surface.internalLabel).toContain("Water mark");
    expect(tagByKey("crack")?.defectType).toBe("plaster_cracks");
  });
});

describe("extent is a quantity, and rises with how much there is", () => {
  it("gives every extent a quantity, each larger than the last", () => {
    const q = SPOT_EXTENTS.map((e) => DEFAULT_EXTENT_QTY[e]);
    expect(q).toEqual([...q].sort((a, b) => a - b));
    expect(new Set(q).size).toBe(q.length);
  });
});
