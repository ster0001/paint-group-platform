import { describe, expect, it } from "vitest";
import { pickedRooms, starterRoomNames } from "./some-rooms";
import { starterRoomList } from "./starter";

/** 14 Sep — "Some rooms" picks from the same list the submit route seeds. */
describe("some rooms", () => {
  it("names exactly the rooms the quick look would seed", () => {
    const names = starterRoomNames({ bedrooms: 3, storeys: "single" });
    const seeded = starterRoomList({ bedrooms: 3, storeys: "single", sizeBand: "unsure", openPlanKitchenLiving: false }).map((r) => r.name);
    expect(names).toEqual(seeded);
    expect(names).toContain("Bed 1");
    expect(names).toContain("Kitchen / Meals");
  });
  it("clamps the bedroom count the way the state does", () => {
    expect(starterRoomNames({ bedrooms: 0, storeys: "single" })).toEqual(starterRoomNames({ bedrooms: 1, storeys: "single" }));
    expect(starterRoomNames({ bedrooms: 12, storeys: "single" })).toEqual(starterRoomNames({ bedrooms: 8, storeys: "single" }));
  });
  it("filters the seeded list by the picked names, and falls back to every room when nothing usable was picked", () => {
    const list = starterRoomList({ bedrooms: 2, storeys: "single", sizeBand: "unsure", openPlanKitchenLiving: false });
    expect(pickedRooms(list, ["Bed 1", "Bathroom"]).map((r) => r.name)).toEqual(["Bed 1", "Bathroom"]);
    expect(pickedRooms(list, null)).toBe(list);
    expect(pickedRooms(list, [])).toBe(list);
    expect(pickedRooms(list, ["Not a room"])).toBe(list);
  });
});
