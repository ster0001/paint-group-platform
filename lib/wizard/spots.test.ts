import { describe, expect, it } from "vitest";
import {
  AUTO_PRICED, ROOM_CONDITION_LABEL, SPOT_TAGS, roomConditionDeferred,
  spotLine, tagByKey, tagsFor,
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

  it("prices a crack from defect_prep_rates and raises no review", () => {
    const out = spotLine({ tag: "crack" }, room, rates, nextId)!;
    expect(out.surface.prepHr).toBe(0.25);
    expect(out.surface.code).toBe("plaster_cracks");
    expect(out.surface.internalLabel).toBe("Repair — Crack");
    expect(out.deferred).toBeNull();
  });

  it("records a water mark as a line but leaves the price to a person", () => {
    const out = spotLine({ tag: "water", sourceId: "src-1" }, room, rates, nextId)!;
    expect(out.surface.prepHr).toBe(0);
    expect(out.surface.internalLabel).toContain("to price");
    expect(out.deferred?.areaId).toBe(7);
    expect(out.deferred?.needs).toContain("with a photo");
  });

  /**
   * The spot is ALWAYS a line, priced or not. A spot that only became an
   * amber note in an estimator's queue would be the free-text box §2.3
   * complains about, wearing a tag.
   */
  it("always pins a line to the room, priced or not", () => {
    for (const tag of SPOT_TAGS) {
      const out = spotLine({ tag: tag.key }, room, rates, nextId)!;
      expect(out.surface, tag.key).toBeTruthy();
      expect(out.surface.crewNote, tag.key).toContain("customer flagged");
    }
  });

  /** An auto-priced tag with no rate row must not be silently free. */
  it("raises 'needs pricing' when the rate table has no row for it", () => {
    const out = spotLine({ tag: "crack" }, room, [], nextId)!;
    expect(out.surface.prepHr).toBe(0);
    expect(out.deferred?.what).toContain("needs pricing");
    expect(out.deferred?.needs).toContain("seed defect_prep_rates");
  });

  it("always uses severity 1 — a customer cannot judge severity", () => {
    // sev1 for a crack is 0.25; sev2 would be 0.5.
    expect(spotLine({ tag: "crack" }, room, rates, nextId)!.surface.prepHr).toBe(0.25);
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
