import { describe, expect, it } from "vitest";
import { confirmStateOf, isSettled, loopConfirmState, loopProgress } from "./confirm-state";
import { applyRoomDims, applyRoomSizeOk, defaultInteriorLoop } from "./rooms-loop";
import { DEFAULT_BANDS } from "./policy";

/** Go-live brief C1 (18 Nov 2026): the quote stage settles a room on its measure card — that must feed the one confirm state. */
const room = (id: number, over: Record<string, unknown> = {}) => ({ id, kind: "area", type: "Interior", areaType: "room", name: `Room ${id}`, L: 4, W: 3, H: 2.4, isOption: false, surfaces: [], ...over });

describe("the loop confirm state reads the quote stage's answers", () => {
  it("Looks right / Not sure (the typical) = confirmed; a typed size = measured; untouched = pending", () => {
    let blocks = [room(1), room(2), room(3)];
    expect(confirmStateOf(blocks[0] as never)).toBe("pending");
    const r1 = applyRoomSizeOk(blocks as never, 1); if (!r1.ok) throw new Error(r1.error); blocks = r1.blocks as typeof blocks;
    const r2 = applyRoomDims(blocks as never, 2, 4.2, 3.1, null); if (!r2.ok) throw new Error(r2.error); blocks = r2.blocks as typeof blocks;
    expect(confirmStateOf(blocks[0] as never)).toBe("confirmed");
    expect(confirmStateOf(blocks[1] as never)).toBe("measured");
    expect(confirmStateOf(blocks[2] as never)).toBe("pending");
    expect(isSettled("confirmed") && isSettled("measured") && !isSettled("pending") && !isSettled(undefined)).toBe(true);
    const s = loopConfirmState(blocks, defaultInteriorLoop(), null);
    expect([...s.states.entries()]).toEqual([[1, "confirmed"], [2, "measured"], [3, "pending"]]);
  });
  it("the old Confirm button still counts, and the strip's N of N counts settled rooms (H4)", () => {
    let blocks = [room(1, { customer: { confirmed: true } }), room(2), room(3)];
    const r3 = applyRoomDims(blocks as never, 3, 5, 4, null); if (!r3.ok) throw new Error(r3.error); blocks = r3.blocks as typeof blocks;
    expect(loopProgress({ blocks })).toEqual({ confirmed: 2, total: 3, unit: "rooms" });
    const r2 = applyRoomSizeOk(blocks as never, 2); if (!r2.ok) throw new Error(r2.error); blocks = r2.blocks as typeof blocks;
    expect(loopProgress({ blocks })).toEqual({ confirmed: 3, total: 3, unit: "rooms" });
  });
  it("D1: the shipped bands are 15 / 12 / 8 with the 8 floor", () => {
    expect([DEFAULT_BANDS.widePct, DEFAULT_BANDS.midPct, DEFAULT_BANDS.tightPct]).toEqual([15, 12, 8]);
  });
});
