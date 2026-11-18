import { describe, expect, it } from "vitest";
import { hallDoors, starterRoomList } from "./starter";
import { journeyFromRow } from "./journey";
import { mobileScreensFor, applyColourChoice } from "./mobileScreens";
import { DEFAULT_QUICK_LOOK, type QuickLook } from "./quick-look";
import { stepsFor } from "./quick-look";
import { OCCUPANCY_MODIFIERS, applySiteAccess } from "./site-access";
import { defaultSides, partExists, sideAddableParts, togglePart } from "./exterior-model";
import { paintScreenParts } from "./mobileScreens";
import { typicalFor } from "./exterior-typicals";
import { houseOfShape } from "@/app/wizard/ExteriorHome";
import type { ExteriorV2 } from "./state";

/**
 * Go-live brief Session 5 — the quote adds up, and copy (H1, H3, H5, M8–M12; D4, D5, D7). H1's arithmetic is
 * `lib/pricing/quoteBreakdown.test.ts` and `lib/quote/quote.test.ts`; H3's table is `lib/pricing/systems.test.ts`.
 */
const q = (over: Partial<QuickLook> = {}): QuickLook => ({ ...DEFAULT_QUICK_LOOK, ...over });
const ids = (quick: QuickLook) => mobileScreensFor(stepsFor(quick.jobType, quick.propertyKind, undefined, undefined, quick.scope), quick).map((s) => s.id);

describe("go-live S5", () => {
  it("M8 (⚑ D7): the phone asks the bold question after New colours or Still deciding, never after Same colours", () => {
    expect(ids(q())).toContain("bold"); // everything ticked = new colours
    expect(ids(q(applyColourChoice(q(), "deciding")))).toContain("bold");
    expect(ids(q(applyColourChoice(q(), "same")))).not.toContain("bold");
    const list = ids(q());
    expect(list.indexOf("bold")).toBe(list.indexOf("colours") + 1);
    expect(list[list.indexOf("bold") + 1]).toBe("condition");
    // an outside job has no interior colours screen, so no bold screen
    expect(ids(q({ jobType: "exterior" }))).not.toContain("bold");
  });

  it("M9 (⚑ D7): the hall carries the hall side of every door that opens onto it plus the front door; a landing its own storey's doors", () => {
    const single = starterRoomList({ bedrooms: 3, storeys: "single", bathrooms: 1, openPlanKitchenLiving: true } as Parameters<typeof starterRoomList>[0]);
    // Bed 1–3, Bathroom, Laundry open onto the hall (5) + the inside of the front door
    expect(hallDoors(single, "Ground")).toBe(6);
    const double = starterRoomList({ bedrooms: 3, storeys: "double", bathrooms: 2, separateToilet: true, openPlanKitchenLiving: true } as Parameters<typeof starterRoomList>[0]);
    expect(hallDoors(double, "Ground")).toBe(3); // Laundry, WC + the front door
    expect(hallDoors(double, "First")).toBe(5); // Bed 1–3, Bathroom, Ensuite — no front door upstairs
  });

  it("M10: a wizard row with no bucket is never Online now", () => {
    expect(journeyFromRow({ id: "x" }).bucket).toBe("dropped");
    expect(journeyFromRow({ id: "x", bucket: "garbage" }).bucket).toBe("dropped");
    expect(journeyFromRow({ id: "x", bucket: "online_now" }).bucket).toBe("online_now");
  });

  it("H5 (D4): rooms cleared applies no loading; furnished and occupied stand", () => {
    expect(OCCUPANCY_MODIFIERS.yes).toBeNull();
    expect(OCCUPANCY_MODIFIERS.no?.code).toBe("STG-FURNISHED");
    const seeded = [{ code: "STG-FURNISHED", multiplier: 1.04 }, { code: "STG-PART-CLEARED", multiplier: 1.02 }, { code: "STG-EMPTY", multiplier: 1.02 }] as Parameters<typeof applySiteAccess>[1];
    expect(applySiteAccess({ cleared: "yes" }, seeded).modSel).toEqual({});
    expect(applySiteAccess({ cleared: "no" }, seeded).modSel).toEqual({ Staging: "STG-FURNISHED" });
  });

  it("Tom, 19 Nov 2026: a handrail or balustrade can be ticked without a verandah — on the Painting screens, on a side, and it prices", () => {
    const bare = { ...houseOfShape("cal", null, []), parts: [] as ExteriorV2["parts"], wall: { down: null, up: null, brickPainted: null, timberPainted: null }, sizeBand: "md" as const };
    const blank: ExteriorV2 = { ...bare, sides: defaultSides(bare) };
    expect(paintScreenParts("p-ver", blank)).toEqual(["verandah", "handrail"]); // the posts and ceiling still wait for the verandah
    const rail = togglePart(blank, "handrail");
    expect(rail.parts).toEqual(["handrail"]); // no verandah ticked for it
    expect(togglePart(blank, "posts").parts).toEqual(["verandah", "posts"]); // the posts still bring the verandah
    const t = typicalFor("cal", []);
    expect(partExists(rail, "front", "handrail", t)).toBe(true);
    expect(sideAddableParts(blank, "back", t)).toContain("handrail");
    expect(sideAddableParts(blank, "back", t)).not.toContain("posts");
  });
});
