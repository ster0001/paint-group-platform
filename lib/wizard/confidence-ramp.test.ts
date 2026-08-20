import { describe, expect, test } from "vitest";
import { accuracyScore, type ScoredArea } from "./accuracy";
import { loopConfirmState } from "./confirm-state";
import { applyRoomSizeOk, defaultInteriorLoop, type LooseBlock } from "./rooms-loop";
import { defaultSidesLoop } from "./sides";

/**
 * R5 (Tom, 20 Aug 2026): "with every room or surface they finalise, it gets
 * more confident."
 *
 * The bug these guard: before R5 a customer could agree with every room in
 * the house and the ring never moved — measured stuck at 18% across a full
 * walk-through of the no-plan path. Pure-function tests missed it because
 * every function did what its own test said; nothing asserted that the
 * NUMBER CHANGES.
 */

const area = (over: Partial<ScoredArea> = {}): ScoredArea => ({
  priceCents: 100_000, origin: "ai_extracted", confidence: 0.9, assumedFields: [], ...over,
});

describe("the confidence score climbs as the loop is worked", () => {
  test("an unconfirmed plan-read room is capped well below a confirmed one", () => {
    const pending = accuracyScore([area({ confirmState: "pending" })]);
    const confirmed = accuracyScore([area({ confirmState: "confirmed" })]);
    expect(pending).toBeLessThan(70);
    expect(confirmed).toBeGreaterThan(90);
    expect(confirmed - pending).toBeGreaterThan(25);
  });

  test("every extra room confirmed moves the score UP, never down", () => {
    const rooms = 6;
    const scoreAfter = (done: number) =>
      accuracyScore(Array.from({ length: rooms }, (_, i) =>
        area({ confirmState: i < done ? "confirmed" : "pending" })));
    const walk = Array.from({ length: rooms + 1 }, (_, i) => scoreAfter(i));
    for (let i = 1; i < walk.length; i++) expect(walk[i]).toBeGreaterThan(walk[i - 1]);
    expect(walk[0]).toBeLessThan(70);
    expect(walk[rooms]).toBeGreaterThan(90);
  });

  test("the whole-job checks are worth a little, and can't carry the score", () => {
    const areas = [area({ confirmState: "pending" })];
    expect(accuracyScore(areas, 0, 2)).toBeGreaterThan(accuracyScore(areas, 0, 0));
    // Six checks and nothing confirmed still reads as an unconfirmed job.
    expect(accuracyScore(areas, 0, 6)).toBeLessThan(75);
  });

  test("an area outside any loop scores exactly as it did before R5", () => {
    expect(accuracyScore([area()])).toBe(accuracyScore([area({ confirmState: undefined })]));
    expect(accuracyScore([area()])).toBe(92);
  });

  test("a confirmed room with an assumed ceiling is still docked for it", () => {
    const withH = accuracyScore([area({ confirmState: "confirmed", assumedFields: ["H"] })]);
    const without = accuracyScore([area({ confirmState: "confirmed" })]);
    expect(withH).toBeLessThan(without);
  });
});

describe("agreeing with a size is an answer", () => {
  const starterRoom = (): LooseBlock => ({
    id: 1, kind: "area", name: "Bed 1", roomType: "bedroom", type: "Interior",
    L: 3.5, W: 3.25, H: 2.4, origin: "ai_assumed", confidence: 0.5,
    assumedFields: ["H", "L", "W"], surfaces: [],
  });

  test('"Looks right" settles L and W, exactly as typing them would', () => {
    const r = applyRoomSizeOk([starterRoom()], 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.blocks[0];
    expect(b.origin).toBe("customer_stated");
    expect(b.assumedFields).toEqual(["H"]); // the height was never asked about
    expect(b.customer?.size).toBe("yes");
  });

  test("the no-plan starter house lifts off the floor as rooms are confirmed", () => {
    const scoreOf = (confirmedCount: number) => {
      const blocks: LooseBlock[] = Array.from({ length: 6 }, (_, i) => {
        const b = starterRoom();
        b.id = i + 1;
        if (i < confirmedCount) {
          b.origin = "customer_stated"; b.confidence = 0.85; b.assumedFields = ["H"];
          b.customer = { size: "yes", cup: null, confirmed: true };
        }
        return b;
      });
      const loop = loopConfirmState(blocks, defaultInteriorLoop(), defaultSidesLoop());
      return accuracyScore(
        blocks.map((b) => ({
          priceCents: 100_000,
          origin: String(b.origin),
          confidence: Number(b.confidence),
          assumedFields: b.assumedFields as string[],
          confirmState: loop.states.get(Number(b.id)),
        })),
        0, loop.checksDone,
      );
    };
    expect(scoreOf(0)).toBeLessThan(35);
    expect(scoreOf(6)).toBeGreaterThan(scoreOf(0) + 40);
  });
});

describe("loopConfirmState names only what a card can confirm", () => {
  test("the whole-job exterior extras block is never left pending", () => {
    const blocks = [
      { id: 1, kind: "area", type: "Exterior", areaType: "surface", name: "Exterior - Front" },
      { id: 2, kind: "area", type: "Exterior", name: "Exterior - Extras" },
    ];
    const { states } = loopConfirmState(blocks, null, defaultSidesLoop());
    expect(states.get(1)).toBe("pending");
    expect(states.has(2)).toBe(false);
  });

  test("an excluded side is not held pending either", () => {
    const blocks = [
      { id: 1, kind: "area", type: "Exterior", areaType: "surface", name: "Exterior - Left", isOption: true },
    ];
    expect(loopConfirmState(blocks, null, defaultSidesLoop()).states.has(1)).toBe(false);
  });

  test("with no loop at all, nothing is marked — staff estimates are untouched", () => {
    const blocks = [{ id: 1, kind: "area", type: "Interior", name: "Bed 1" }];
    expect(loopConfirmState(blocks, null, null).states.size).toBe(0);
  });
});
