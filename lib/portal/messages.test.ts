import { describe, expect, it } from "vitest";
import { groupThreads } from "./messages";

const est = (id: string, over: Partial<{ title: string | null; status: string; share_token: string | null; sent_at: string | null }> = {}) => ({
  id, title: `${id} Street`, status: "sent", share_token: `tok-${id}`, sent_at: "2026-10-01T00:00:00Z", created_at: "2026-09-30T00:00:00Z", ...over,
});
const msg = (estimate_id: string, direction: "staff" | "customer", created_at: string) => ({
  id: `${estimate_id}-${created_at}`, estimate_id, direction, body: "hi", author_name: direction === "staff" ? "Robyn" : null, created_at,
});

describe("groupThreads — one thread per sent estimate, with the unread count", () => {
  it("carries the estimate status, sorts by last activity and takes unread from the mirror count", () => {
    const threads = groupThreads(
      [est("a"), est("b", { status: "accepted" }), est("c", { status: "draft", sent_at: null })],
      [msg("a", "customer", "2026-10-02T00:00:00Z"), msg("b", "staff", "2026-10-05T00:00:00Z"), msg("b", "staff", "2026-10-06T00:00:00Z")],
      new Set(["b"]),
      new Map([["b", 2]]),
    );
    expect(threads.map((t) => t.estimateId)).toEqual(["b", "a"]); // the draft never lists
    expect(threads[0]).toMatchObject({ status: "accepted", hasInvoice: true, unread: 2, lastAt: "2026-10-06T00:00:00Z" });
    expect(threads[1]).toMatchObject({ status: "sent", hasInvoice: false, unread: 0 });
  });
  it("a sent estimate with no messages still lists (the list page hides it; the picker offers it)", () => {
    const [t] = groupThreads([est("a")], [], new Set());
    expect(t.messages).toHaveLength(0);
    expect(t.unread).toBe(0);
  });
});
