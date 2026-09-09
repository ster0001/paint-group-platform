import { describe, expect, it } from "vitest";
import {
  AUTO_PRICED, EXTENT_SEVERITY, ROOM_CONDITION_LABEL, SPOT_EXTENTS, SPOT_TAGS,
  roomConditionDeferred, spotLine, tagByKey, tagsFor,
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
    expect(out.surface.prepHr).toBe(0.25);
    expect(out.surface.code).toBe("plaster_cracks");
    expect(out.deferred).toBeNull();
  });

  /**
   * Tom, 9 Sep: peeling in two spots is not peeling across a whole job. The
   * customer's words map onto the severity columns defect_prep_rates already
   * carries — nobody can answer "is this severity 2", but anyone standing in
   * the room can answer "a couple of spots, or most of it".
   */
  it("prices by EXTENT, not by presence", () => {
    const spots = spotLine({ tag: "water", extent: "spots", sourceId: "s1" }, room, rates, nextId)!;
    const patches = spotLine({ tag: "water", extent: "patches", sourceId: "s1" }, room, rates, nextId)!;
    const most = spotLine({ tag: "water", extent: "most", sourceId: "s1" }, room, rates, nextId)!;
    expect(spots.surface.prepHr).toBe(0.4);
    expect(patches.surface.prepHr).toBe(0.9);
    expect(most.surface.prepHr).toBe(1.6);
  });

  it("treats a missing extent as the safe floor, not the worst case", () => {
    expect(spotLine({ tag: "water", sourceId: "s1" }, room, rates, nextId)!.surface.prepHr).toBe(0.4);
  });

  /**
   * Photos earn a price; words earn an estimator. Extent IS the question for
   * flaking or rot, and a photo is the only thing that settles it — a sentence
   * is a claim, a photo is evidence. Nothing is lost either way: the line is
   * on the job and the work order regardless.
   */
  it("prices a water mark WITH a photo, and sends it for sign-off", () => {
    const out = spotLine({ tag: "water", extent: "patches", sourceId: "src-1" }, room, rates, nextId)!;
    expect(out.surface.prepHr).toBe(0.9);
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
    expect(spotLine({ tag: "crack", extent: "most" }, room, rates, nextId)!.surface.prepHr).toBe(1);
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

describe("extent maps onto the table that already exists", () => {
  it("uses all three severity columns", () => {
    expect(SPOT_EXTENTS.map((e) => EXTENT_SEVERITY[e])).toEqual([1, 2, 3]);
  });
});
