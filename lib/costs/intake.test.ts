import { describe, expect, it } from "vitest";
import {
  accuracyReadout,
  autoConfirmExactRef,
  duplicateWindowDays,
  jobCode,
  queueRows,
} from "./intake";

describe("jobCode — the PG order reference (⚑A3/⚑21)", () => {
  it("pads to four digits and grows past them", () => {
    expect(jobCode(87)).toBe("PG-0087");
    expect(jobCode(3)).toBe("PG-0003");
    expect(jobCode(12345)).toBe("PG-12345");
  });
  it("nothing for nothing", () => {
    expect(jobCode(null)).toBe("");
    expect(jobCode(0)).toBe("");
    expect(jobCode(undefined)).toBe("");
  });
});

const TODAY = "2026-08-25";
const day = (n: number) => new Date(Date.UTC(2026, 7, n)).toISOString();

describe("accuracyReadout — the evidence that rules ⚑A1", () => {
  it("computes the three percentages over the last 30 days", () => {
    const rows = [
      // exact ref, confirmed unchanged
      { status: "confirmed" as const, match_reason: "order_ref" as const, proposed_wo_id: "a", confirmed_wo_id: "a", confirmed_at: day(20) },
      // address proposal corrected to another job
      { status: "confirmed" as const, match_reason: "address" as const, proposed_wo_id: "a", confirmed_wo_id: "b", confirmed_at: day(21) },
      // no proposal, human picked
      { status: "confirmed" as const, match_reason: "none" as const, proposed_wo_id: null, confirmed_wo_id: "c", confirmed_at: day(22) },
      // rejected still counts as decided
      { status: "rejected" as const, match_reason: "none" as const, proposed_wo_id: null, confirmed_wo_id: null, confirmed_at: day(22) },
      // too old — outside the window
      { status: "confirmed" as const, match_reason: "order_ref" as const, proposed_wo_id: "z", confirmed_wo_id: "z", confirmed_at: "2026-06-01T00:00:00Z" },
      // undecided — not counted
      { status: "pending" as const, match_reason: "order_ref" as const, proposed_wo_id: "y", confirmed_wo_id: null, confirmed_at: null },
    ];
    const r = accuracyReadout(rows, TODAY);
    expect(r.decided).toBe(4);
    expect(r.exactRefPct).toBe(25); // 1 of 4
    expect(r.unchangedPct).toBe(33); // 1 of 3 confirmed
    expect(r.correctedPct).toBe(33); // 1 of 3 confirmed
  });

  it("empty in, nulls out — never a fake 0%", () => {
    const r = accuracyReadout([], TODAY);
    expect(r).toEqual({ decided: 0, exactRefPct: null, unchangedPct: null, correctedPct: null });
  });
});

describe("queueRows — pending + unhandled duplicates, oldest first", () => {
  it("filters and orders", () => {
    const rows = [
      { status: "confirmed" as const, confirmed_at: day(20), created_at: day(19) },
      { status: "pending" as const, confirmed_at: null, created_at: day(22) },
      { status: "duplicate" as const, confirmed_at: null, created_at: day(21) },
      { status: "duplicate" as const, confirmed_at: day(23), created_at: day(20) }, // dismissed
      { status: "rejected" as const, confirmed_at: day(23), created_at: day(18) },
    ];
    expect(queueRows(rows).map((r) => r.created_at)).toEqual([day(21), day(22)]);
  });
});

describe("settings readers — defaults only when the row is absent or wrong", () => {
  it("reads the seeded shape", () => {
    const rows = [{ key: "cost_intake", value: { duplicateWindowDays: 14, autoConfirmExactRef: true } }];
    expect(duplicateWindowDays(rows)).toBe(14);
    expect(autoConfirmExactRef(rows)).toBe(true);
  });
  it("falls back to the brief's defaults", () => {
    expect(duplicateWindowDays(null)).toBe(7);
    expect(autoConfirmExactRef([])).toBe(false); // ⚑A1 OFF
    expect(duplicateWindowDays([{ key: "cost_intake", value: { duplicateWindowDays: 900 } }])).toBe(7);
  });
});
