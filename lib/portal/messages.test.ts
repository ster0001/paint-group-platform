import { describe, expect, it } from "vitest";
import { groupThreads } from "./messages";

const est = (over: Partial<Parameters<typeof groupThreads>[0][number]> = {}) => ({
  id: "e1", title: "41 Devoy St", status: "sent", share_token: "tok1",
  sent_at: "2026-08-20T00:00:00Z", created_at: "2026-08-19T00:00:00Z", ...over,
});
const msg = (over: Partial<Parameters<typeof groupThreads>[1][number]> = {}) => ({
  id: "m1", estimate_id: "e1", direction: "customer" as const, body: "Hi",
  author_name: null, created_at: "2026-08-21T00:00:00Z", ...over,
});

describe("groupThreads — one thread per sent estimate", () => {
  it("drafts never get a thread; sent estimates do, even with no messages yet", () => {
    const threads = groupThreads(
      [est(), est({ id: "e2", status: "draft", sent_at: null, share_token: null })],
      [],
      new Set(),
    );
    expect(threads.map((t) => t.estimateId)).toEqual(["e1"]);
    expect(threads[0].messages).toEqual([]);
  });

  it("messages sort oldest-first inside a thread; threads newest-activity-first", () => {
    const threads = groupThreads(
      [est(), est({ id: "e2", title: "Oakdene", share_token: "tok2" })],
      [
        msg({ id: "m2", created_at: "2026-08-22T00:00:00Z" }),
        msg(),
        msg({ id: "m3", estimate_id: "e2", created_at: "2026-08-25T00:00:00Z" }),
      ],
      new Set(),
    );
    expect(threads[0].estimateId).toBe("e2"); // latest activity leads
    expect(threads[1].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("an estimate with invoices is marked so the page can say the thread covers both", () => {
    const threads = groupThreads([est()], [], new Set(["e1"]));
    expect(threads[0].hasInvoice).toBe(true);
  });
});
