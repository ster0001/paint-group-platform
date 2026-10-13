import { describe, expect, it } from "vitest";
import { expenseTotals, type ExpenseItem } from "./expenses";

const item = (id: string, amountCents: number): ExpenseItem => ({ id, who: "A", ref: "", estimateId: null, amountCents, note: null, overThreshold: false, receiptUrl: null, description: null });

describe("expense queues on the Contractors tab (8b)", () => {
  it("claims and ask-first are decisions; owed-back is money to pay", () => {
    const t = expenseTotals({ claims: [item("c1", 12_000), item("c2", 3_050)], asks: [item("a1", 80_000)], paybacks: [item("p1", 4_500)] });
    expect(t).toEqual({ toDecideCount: 3, claimsCents: 15_050, asksCents: 80_000, owedBackCents: 4_500, owedBackCount: 1 });
  });
});
