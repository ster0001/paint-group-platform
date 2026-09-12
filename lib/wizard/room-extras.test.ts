import { describe, expect, it } from "vitest";
import { applyRoomExtra, roomExtraDeferral, roomExtrasView } from "./room-extras";

describe("C10 — extras in this room are review lines pinned to the room, never a price", () => {
  it("feature walls are counted and named; zero clears", () => {
    const d = roomExtraDeferral({ areaId: 3, room: "Living", kind: "feature_wall", count: 2 });
    expect(d).toMatchObject({ areaId: 3, room: "Living", what: "2 feature walls", count: 2, kind: "room_extra:feature_wall" });
    expect(d?.needs).toMatch(/own colour/);
    expect(roomExtraDeferral({ areaId: 3, room: "Living", kind: "feature_wall", count: 0 })).toBeNull();
    expect(roomExtraDeferral({ areaId: 3, room: "Living", kind: "feature_wall", count: 40 })?.count).toBe(6);
  });
  it("wallpaper is on or off; other needs words", () => {
    expect(roomExtraDeferral({ areaId: 1, room: "Bed 1", kind: "wallpaper", on: true })?.what).toBe("wallpaper to strip first");
    expect(roomExtraDeferral({ areaId: 1, room: "Bed 1", kind: "wallpaper", on: false })).toBeNull();
    expect(roomExtraDeferral({ areaId: 1, room: "Bed 1", kind: "other", text: "  " })).toBeNull();
    expect(roomExtraDeferral({ areaId: 1, room: "Bed 1", kind: "other", text: "ceiling rose" })?.what).toBe('something else in here: "ceiling rose"');
  });
  it("re-answering replaces the room's line of that kind and leaves the others", () => {
    let d = applyRoomExtra([], { areaId: 1, room: "Bed 1", kind: "feature_wall", count: 1 });
    d = applyRoomExtra(d, { areaId: 1, room: "Bed 1", kind: "wallpaper", on: true });
    d = applyRoomExtra(d, { areaId: 2, room: "Bed 2", kind: "feature_wall", count: 1 });
    expect(d).toHaveLength(3);
    d = applyRoomExtra(d, { areaId: 1, room: "Bed 1", kind: "feature_wall", count: 3 });
    expect(d).toHaveLength(3);
    expect(roomExtrasView(d, 1)).toEqual({ featureWalls: 3, wallpaper: true, other: "" });
    d = applyRoomExtra(d, { areaId: 1, room: "Bed 1", kind: "wallpaper", on: false });
    expect(roomExtrasView(d, 1)).toEqual({ featureWalls: 3, wallpaper: false, other: "" });
    expect(roomExtrasView(d, 2)).toEqual({ featureWalls: 1, wallpaper: false, other: "" });
  });
});
