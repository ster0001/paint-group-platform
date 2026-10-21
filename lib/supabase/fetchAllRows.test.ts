import { describe, expect, test } from "vitest";
import { fetchAllRows } from "./fetchAllRows";

/** A table of `n` rows served a page at a time, recording how the pages were asked for. */
function table(n: number) {
  const asked: [number, number][] = [];
  let inFlight = 0;
  let peak = 0;
  const query = async (from: number, to: number) => {
    asked.push([from, to]);
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    return { data: Array.from({ length: Math.max(0, Math.min(n, to + 1) - from) }, (_, i) => from + i), error: null };
  };
  return { query, asked, peak: () => peak };
}

describe("fetchAllRows", () => {
  test("pages one at a time by default and stops at the short page", async () => {
    const t = table(2500);
    const rows = await fetchAllRows<number>(t.query);
    expect(rows).toHaveLength(2500);
    expect(rows[2499]).toBe(2499);
    expect(t.asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(t.peak()).toBe(1);
  });

  test("prefetchPages asks for the first pages together and returns the same rows in order", async () => {
    const t = table(3482);
    const rows = await fetchAllRows<number>(t.query, { prefetchPages: 4 });
    expect(rows).toEqual(Array.from({ length: 3482 }, (_, i) => i));
    expect(t.asked).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999]]);
    expect(t.peak()).toBe(4);
  });

  test("a table that outgrows the prefetch keeps paging one at a time after it", async () => {
    const t = table(4200);
    const rows = await fetchAllRows<number>(t.query, { prefetchPages: 4 });
    expect(rows).toHaveLength(4200);
    expect(t.asked).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999]]);
  });

  test("a table smaller than the prefetch ends at its short page, with no rows past it", async () => {
    const t = table(1200);
    const rows = await fetchAllRows<number>(t.query, { prefetchPages: 4 });
    expect(rows).toEqual(Array.from({ length: 1200 }, (_, i) => i));
  });

  test("a page error throws rather than returning a partial set", async () => {
    const query = async (from: number) => (from === 0 ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null } : { data: null, error: { message: "boom" } });
    await expect(fetchAllRows<number>(query, { prefetchPages: 2 })).rejects.toThrow("boom");
  });
});
