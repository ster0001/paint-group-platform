import { describe, expect, it } from "vitest";
import { materialsToMatch, needsMatching } from "./materialsToMatch";

const row = (id: string, work_order_id: string | null, created_at: string) => ({ id, work_order_id, created_at, supplier: "Haymes", amount_cents: 1, invoice_date: null, order_ref: "", address_text: "" });

describe("materialsToMatch — the one predicate", () => {
  it("needs matching exactly when work_order_id is null; matched_at is not the test", () => {
    expect(needsMatching({ work_order_id: null })).toBe(true);
    expect(needsMatching({ work_order_id: "wo-1" })).toBe(false);
  });
  it("lists the unmatched rows only, newest received first", () => {
    const rows = [row("a", null, "2026-09-18T00:00:00Z"), row("b", "wo-1", "2026-09-19T00:00:00Z"), row("c", null, "2026-09-20T00:00:00Z")];
    expect(materialsToMatch(rows).map((r) => r.id)).toEqual(["c", "a"]);
    expect(materialsToMatch([])).toEqual([]);
  });
});
