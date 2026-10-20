import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkItemNotes, NOTE_KEYS_PER_READ } from "./pcNotes";

/**
 * The dashboard asks for a note on every card at once. One `in` filter over a
 * few hundred keys is a GET URL past the request limit — PostgREST answered 400
 * on the test project and the page said no note could be read (21 Oct 2026).
 * The read goes out in bounded batches, and a batch that fails still fails the
 * whole read loudly.
 */
function fakeClient(answer: (keys: string[]) => { data: unknown; error: { code?: string; message: string } | null }) {
  const calls: string[][] = [];
  const client = {
    from: () => ({
      select: () => ({
        in: async (_col: string, keys: string[]) => { calls.push(keys); return answer(keys); },
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("loadWorkItemNotes", () => {
  it("reads in batches no longer than the cap and merges every row", async () => {
    const keys = Array.from({ length: NOTE_KEYS_PER_READ * 3 + 7 }, (_, i) => `colours:${i}`);
    const { client, calls } = fakeClient((batch) => ({
      data: batch.filter((k) => k.endsWith("1")).map((k) => ({ item_key: k, note: `note ${k}` })), error: null,
    }));
    const r = await loadWorkItemNotes(client, keys);
    expect(r.failure).toBeNull();
    expect(calls.length).toBe(4);
    expect(Math.max(...calls.map((c) => c.length))).toBeLessThanOrEqual(NOTE_KEYS_PER_READ);
    expect(calls.flat()).toEqual(keys);
    expect(r.notes.get("colours:1")).toBe("note colours:1");
    expect(r.notes.get("colours:301")).toBe("note colours:301");
    expect(r.notes.size).toBe(keys.filter((k) => k.endsWith("1")).length);
  });

  it("asks once per distinct key and nothing for none", async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    await loadWorkItemNotes(client, ["a", "a", "b"]);
    expect(calls).toEqual([["a", "b"]]);
    await loadWorkItemNotes(client, []);
    expect(calls.length).toBe(1);
  });

  it("a rejected batch is a failure line, never an empty map that looks like no notes", async () => {
    const keys = Array.from({ length: NOTE_KEYS_PER_READ + 1 }, (_, i) => `k${i}`);
    const { client } = fakeClient((batch) => batch.length === 1
      ? { data: null, error: { message: "Bad Request" } }
      : { data: [{ item_key: "k0", note: "x" }], error: null });
    const r = await loadWorkItemNotes(client, keys);
    expect(r.failure).toMatch(/could not be read/);
  });
});
