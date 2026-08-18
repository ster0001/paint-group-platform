import { describe, expect, it } from "vitest";
import { buildDraft } from "@/lib/extract/draft";
import type { ScopeRule } from "@/lib/extract/scope";
import {
  FALLBACK_TYPICALS,
  markStarterProvenance,
  starterExtraction,
  starterRoomList,
  typicalSize,
} from "./starter";
import type { WizardBasics } from "./state";

const basics = (over: Partial<WizardBasics> = {}): WizardBasics => ({
  bedrooms: 3,
  storeys: "single",
  sizeBand: "s120_200",
  openPlanKitchenLiving: true,
  ...over,
});

/** Minimal rules: walls + ceiling for every starter room type. */
const RULES: ScopeRule[] = [
  "bedroom", "living", "kitchen", "open_plan_kitchen_living", "bathroom", "laundry", "hallway",
].flatMap((room_type) => [
  { room_type, surface_type: "Walls", is_option: false, requires_confirm: false, notes: null },
  { room_type, surface_type: "Ceiling", is_option: false, requires_confirm: false, notes: null },
  { room_type, surface_type: "Door & Frame", is_option: false, requires_confirm: false, notes: null },
]);

describe("starterRoomList", () => {
  it("open-plan single storey matches the mockup composition", () => {
    const rooms = starterRoomList(basics());
    expect(rooms.map((r) => r.name)).toEqual([
      "Bed 1", "Bed 2", "Bed 3", "Kitchen / Living", "Bathroom", "Laundry", "Hall & Entry",
    ]);
    expect(rooms.every((r) => r.storey === "Ground")).toBe(true);
    // Scoped as a living room (real scope rules), sized from the 36 m² archetype.
    const op = rooms.find((r) => r.name === "Kitchen / Living");
    expect(op?.roomType).toBe("living");
    expect(op?.sizeType).toBe("open_plan_kitchen_living");
  });

  it("separate kitchen swaps the archetype", () => {
    const rooms = starterRoomList(basics({ openPlanKitchenLiving: false }));
    const names = rooms.map((r) => r.name);
    expect(names).toContain("Living room");
    expect(names).toContain("Kitchen / Meals");
    expect(names).not.toContain("Kitchen / Living");
  });

  it("double storey sends bedrooms and bathroom up and adds the landing", () => {
    const rooms = starterRoomList(basics({ storeys: "double", bedrooms: 4 }));
    const up = rooms.filter((r) => r.storey === "First").map((r) => r.name);
    expect(up).toEqual(["Bed 1", "Bed 2", "Bed 3", "Bed 4", "Bathroom", "Landing & stairs"]);
    expect(rooms.find((r) => r.name === "Laundry")?.storey).toBe("Ground");
  });
});

describe("typicalSize", () => {
  it("prefers the Settings row over the fallback", () => {
    expect(typicalSize("bedroom", [{ room_type: "bedroom", typical_length_m: 4, typical_width_m: 3 }]))
      .toEqual({ L: 4, W: 3 });
    expect(typicalSize("bedroom", [])).toEqual(FALLBACK_TYPICALS.bedroom);
  });

  it("unknown types fall back to a bedroom rather than zero", () => {
    expect(typicalSize("orangery", [])).toEqual(FALLBACK_TYPICALS.bedroom);
  });
});

describe("starterExtraction → buildDraft", () => {
  it("drafts every starter room at its typical size, tagged ai_assumed", () => {
    const rooms = starterRoomList(basics());
    const x = starterExtraction(rooms, [], { heightM: 2.7, bedrooms: 3 });
    const draft = buildDraft(x, RULES, []);
    markStarterProvenance(draft.areas);

    expect(draft.areas).toHaveLength(rooms.length);
    const openPlan = draft.areas.find((a) => a.name === "Kitchen / Living");
    expect(openPlan?.L).toBe(FALLBACK_TYPICALS.open_plan_kitchen_living.L);
    expect(openPlan?.roomType).toBe("living");
    const bed = draft.areas.find((a) => a.name === "Bed 1");
    expect(bed?.L).toBe(FALLBACK_TYPICALS.bedroom.L);
    expect(bed?.W).toBe(FALLBACK_TYPICALS.bedroom.W);
    expect(bed?.H).toBe(2.7);
    expect(bed?.roomType).toBe("bedroom");
    for (const a of draft.areas) {
      expect(a.origin).toBe("ai_assumed");
      expect(a.assumedFields).toContain("L");
      expect(a.assumedFields).toContain("W");
      expect(a.L).toBeGreaterThan(0); // typical sizes still price
    }
  });

  it("a double storey drafts canonical lowercase storey keys on every node", () => {
    const rooms = starterRoomList(basics({ storeys: "double" }));
    const x = starterExtraction(rooms, [], { heightM: 2.7, bedrooms: 3 });
    const draft = buildDraft(x, RULES, []);
    expect(draft.areas.find((a) => a.name === "Bed 1")?.storey).toBe("first");
    expect(draft.areas.find((a) => a.name === "Laundry")?.storey).toBe("ground");
  });

  it("doors stay deferred until the wizard's style answer resolves them", () => {
    const rooms = starterRoomList(basics());
    const x = starterExtraction(rooms, [], { heightM: null, bedrooms: 3 });
    const draft = buildDraft(x, RULES, []);
    // 3 beds + bathroom + laundry own-side doors, hallway carries 3 hall sides
    const doorDeferred = draft.deferred.filter((d) => /door/.test(d.what));
    expect(doorDeferred.reduce((n, d) => n + d.count, 0)).toBe(8);
    const hall = doorDeferred.find((d) => d.room === "Hall & Entry");
    expect(hall?.count).toBe(3);
  });

  it("wet areas are marked and an unsure height rides as null", () => {
    const x = starterExtraction(starterRoomList(basics()), [], { heightM: null, bedrooms: 3 });
    expect(x.ceiling_height_m).toBeNull();
    expect(x.rooms.find((r) => r.name_on_plan === "Bathroom")?.wet_area).toBe(true);
    expect(x.rooms.find((r) => r.name_on_plan === "Bed 1")?.wet_area).toBe(false);
  });
});
