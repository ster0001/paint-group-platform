/**
 * C16 (b) — a proposal never overwrites a confirmation (amber never becomes cyan).
 */
import { describe, expect, it } from "vitest";
import { clearProposed, foldSizeProposal, isConfirmed, proposedOf } from "./proposals";
import { applyRoomSizeOk, applyRoomDims } from "./rooms-loop";

const block = (origin: string, over: Record<string, unknown> = {}) => ({
  id: 1, kind: "area", name: "Bed 1", type: "Interior", roomType: "bedroom", L: 4, W: 3, H: 2.4,
  origin, confidence: origin === "ai_assumed" ? 0.4 : 1, assumedFields: origin === "ai_assumed" ? ["L", "W"] : [], surfaces: [], ...over,
});

describe("foldSizeProposal", () => {
  it("applies to an unconfirmed room as amber and takes the dimensions off the assumed list", () => {
    const r = foldSizeProposal(block("ai_assumed"), { L: 4.2, W: 3.8 }, { origin: "ai_extracted", by: "brief" });
    expect(r.applied).toBe(true);
    expect(r.block.L).toBe(4.2);
    expect(r.block.W).toBe(3.8);
    expect(r.block.origin).toBe("ai_extracted");
    expect(r.block.assumedFields).toEqual([]);
    expect(proposedOf(r.block)).toBeNull();
  });
  it("never changes a confirmed room — the proposal waits beside it", () => {
    for (const origin of ["human_confirmed", "customer_stated"]) {
      const before = block(origin);
      const r = foldSizeProposal(before, { L: 4.2, W: 3.8 }, { origin: "ai_extracted", by: "photo", at: new Date("2026-09-14T00:00:00Z") });
      expect(r.applied).toBe(false);
      expect(r.block.L).toBe(4);
      expect(r.block.W).toBe(3);
      expect(r.block.origin).toBe(origin);
      expect(isConfirmed(r.block)).toBe(true);
      expect(proposedOf(r.block)).toEqual({ origin: "ai_extracted", by: "photo", at: "2026-09-14T00:00:00.000Z", L: 4.2, W: 3.8 });
    }
  });
  it("an empty proposal is a no-op; clearing removes the pending one", () => {
    const b = block("human_confirmed");
    expect(foldSizeProposal(b, {}, { origin: "ai_derived", by: "photo" })).toEqual({ block: b, applied: false });
    const withP = foldSizeProposal(b, { L: 5 }, { origin: "ai_derived", by: "photo" }).block;
    expect(proposedOf(withP)?.L).toBe(5);
    expect("proposed" in clearProposed(withP)).toBe(false);
  });
});

describe("the room card's own confirmations settle a pending proposal", () => {
  it("Looks right and a typed size both clear it, and stamp the customer's provenance", () => {
    const pending = foldSizeProposal(block("customer_stated"), { L: 5, W: 4 }, { origin: "ai_extracted", by: "brief" }).block;
    const ok = applyRoomSizeOk([pending], 1);
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect((ok.blocks[0] as { proposed?: unknown }).proposed).toBeUndefined(); expect(ok.blocks[0].L).toBe(4); }
    const dims = applyRoomDims([pending], 1, 5, 4);
    expect(dims.ok).toBe(true);
    if (dims.ok) { expect((dims.blocks[0] as { proposed?: unknown }).proposed).toBeUndefined(); expect(dims.blocks[0].L).toBe(5); expect(dims.blocks[0].origin).toBe("customer_stated"); }
  });
});
