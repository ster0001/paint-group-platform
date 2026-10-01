import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// notifyStaff is the shared send path; here only the decision of WHICH
// estimates to alert for is under test.
const notifyStaff = vi.fn(async () => "sent" as const);
vi.mock("@/lib/staff/notify", () => ({ notifyStaff: (...a: unknown[]) => notifyStaff(...(a as [])) }));
vi.mock("@/lib/monitoring/report", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/invoicing/pdf", () => ({ siteUrl: () => "https://example.test" }));

import { notifyOfficeOfDecline, notifyOfficeOfExpiry, notifyOfficeOfLapsedEstimates } from "./lifecycleNotify";

type Row = Record<string, unknown>;

/** A tiny chainable stand-in: one table → one answer. */
function fakeDb(tables: Record<string, Row[] | { error: { message: string } }>): SupabaseClient {
  const from = (table: string) => {
    const answer = tables[table] ?? [];
    const q = {
      select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => Array.isArray(answer) ? { data: answer[0] ?? null, error: null } : { data: null, error: answer.error },
      then: (res: (v: unknown) => void) => res(Array.isArray(answer) ? { data: answer, error: null } : { data: null, error: answer.error }),
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const est = (over: Row): Row => ({
  id: "e1", title: "Interior repaint", status: "sent", total_cents: 220000, valid_until: "2026-09-30", declined_reason: null,
  builder_state: { contact: { name: "Casey Chen" } }, sent_snapshot: { jobAddress: "7 Refusal Rd", contactName: "Casey Chen", totalCents: 220000 },
  ...over,
});

describe("notifyOfficeOfDecline", () => {
  it("alerts once for a declined estimate, naming the customer, job, total and reason", async () => {
    notifyStaff.mockClear();
    const r = await notifyOfficeOfDecline(fakeDb({ estimates: [est({ status: "declined", declined_reason: "Price — too much" })] }), "e1");
    expect(r).toBe("sent");
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    const alert = (notifyStaff.mock.calls[0] as unknown[])[1] as { key: string; entityId: string; vars: Record<string, string>; link: string };
    expect(alert.key).toBe("office_estimate_declined");
    expect(alert.entityId).toBe("e1");
    expect(alert.vars).toEqual({ customer: "Casey Chen", job: "Interior repaint · 7 Refusal Rd", total: "$2,200.00", reason_line: "\n\nTheir reason: Price — too much" });
    expect(alert.link).toBe("https://example.test/quote?id=e1");
  });

  it("does nothing for an estimate that is not declined — the ping is not the proof, the row is", async () => {
    notifyStaff.mockClear();
    expect(await notifyOfficeOfDecline(fakeDb({ estimates: [est({ status: "sent" })] }), "e1")).toBe("not_declined");
    expect(await notifyOfficeOfDecline(fakeDb({ estimates: [] }), "nope")).toBe("not_declined");
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("reports a rejected read instead of treating it as 'no estimate'", async () => {
    notifyStaff.mockClear();
    expect(await notifyOfficeOfDecline(fakeDb({ estimates: { error: { message: "column does not exist" } } }), "e1")).toBe("error");
    expect(notifyStaff).not.toHaveBeenCalled();
  });
});

describe("notifyOfficeOfExpiry", () => {
  it("alerts for an expired estimate with its valid-until date in words", async () => {
    notifyStaff.mockClear();
    expect(await notifyOfficeOfExpiry(fakeDb({ estimates: [est({ status: "expired" })] }), "e1")).toBe("sent");
    const alert = (notifyStaff.mock.calls[0] as unknown[])[1] as { key: string; vars: Record<string, string> };
    expect(alert.key).toBe("office_estimate_expired");
    expect(alert.vars.valid_until).toBe("Wed 30 Sept");
    expect(alert.vars.customer).toBe("Casey Chen");
  });

  it("refuses an estimate that is still sent or was declined", async () => {
    notifyStaff.mockClear();
    expect(await notifyOfficeOfExpiry(fakeDb({ estimates: [est({ status: "sent" })] }), "e1")).toBe("not_expired");
    expect(await notifyOfficeOfExpiry(fakeDb({ estimates: [est({ status: "declined" })] }), "e1")).toBe("not_expired");
    expect(notifyStaff).not.toHaveBeenCalled();
  });
});

describe("notifyOfficeOfLapsedEstimates", () => {
  it("alerts once per estimate whose status_changed event says → expired, ignoring other changes", async () => {
    notifyStaff.mockClear();
    const db = fakeDb({
      estimate_events: [
        { estimate_id: "e1", payload: { to: "expired", from: "sent" } },
        { estimate_id: "e1", payload: { to: "expired", from: "sent" } }, // a re-run wrote it twice
        { estimate_id: "e2", payload: { to: "accepted", from: "sent" } },
        { estimate_id: "e3", payload: null },
      ],
      estimates: [est({ status: "expired" })],
    });
    expect(await notifyOfficeOfLapsedEstimates(db)).toBe(1);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
  });

  it("returns 0 and reports when the events read is rejected", async () => {
    notifyStaff.mockClear();
    expect(await notifyOfficeOfLapsedEstimates(fakeDb({ estimate_events: { error: { message: "permission denied" } } }))).toBe(0);
    expect(notifyStaff).not.toHaveBeenCalled();
  });
});
