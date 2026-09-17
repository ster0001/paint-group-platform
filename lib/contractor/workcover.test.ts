import { describe, expect, it } from "vitest";
import { workcoverNeeded, type ContractorDoc } from "./model";

const doc = (p: Partial<ContractorDoc>): ContractorDoc => ({
  id: "d", contractor_id: "c", kind: "workcover", name: "w.pdf", file_url: "c/w.pdf",
  expires_on: null, status: "pending", created_at: "", verified_at: null, verify_note: "", ...p,
});

// Tom, 17 Sep 2026: WorkCover is required when anyone works with the
// contractor — said in words, never a gate. The gate stays public liability.
describe("workcoverNeeded", () => {
  it("is never needed for a crew of one (or unknown)", () => {
    expect(workcoverNeeded(1, [])).toBe(false);
    expect(workcoverNeeded(null, [])).toBe(false);
    expect(workcoverNeeded(undefined, [])).toBe(false);
  });
  it("is needed for a crew above one with nothing on file", () => {
    expect(workcoverNeeded(2, [])).toBe(true);
    expect(workcoverNeeded(2, [doc({ kind: "insurance" })])).toBe(true);
    expect(workcoverNeeded(2, [doc({ file_url: "" })])).toBe(true);
  });
  it("counts an uploaded certificate even before staff have checked it", () => {
    expect(workcoverNeeded(2, [doc({ verified_at: null })])).toBe(false);
  });
  it("does not count a lapsed certificate", () => {
    expect(workcoverNeeded(2, [doc({ expires_on: "2000-01-01", verified_at: "2000-01-01" })])).toBe(true);
  });
});
