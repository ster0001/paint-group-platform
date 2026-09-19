/**
 * Dashboard 0b — an email open (Resend `email.opened`) is the best read signal
 * email gives. `updateMessageStatus` keeps it as read_at, flagged best-effort,
 * never over a read the portal recorded, and never for any other status.
 * The client is a chainable fake: only the update payload matters here.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateMessageStatus, type MessageStatus } from "./record";

function fakeDb(row: { id: string; account_id: string | null; status: MessageStatus; meta: Record<string, unknown>; read_at: string | null } | null) {
  const updates: Record<string, unknown>[] = [];
  const chain = {
    select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error: null }),
    update: (payload: Record<string, unknown>) => { updates.push(payload); return { eq: async () => ({ error: null }) }; },
  };
  return { db: { from: () => chain } as unknown as SupabaseClient, updates };
}

const at = "2026-09-19T09:00:00.000Z";

describe("dashboard 0b · email open → read", () => {
  it("an open on an unread message sets read_at with the source flagged best-effort", async () => {
    const { db, updates } = fakeDb({ id: "m1", account_id: "a1", status: "delivered", meta: { kind: "estimate" }, read_at: null });
    await updateMessageStatus(db, "resend", "re_1", "opened", at);
    expect(updates).toEqual([{ status: "opened", status_at: at, read_at: at, meta: { kind: "estimate", readSource: "email_open", readIsBestEffort: true } }]);
  });
  it("never overwrites a read the portal already recorded", async () => {
    const { db, updates } = fakeDb({ id: "m1", account_id: "a1", status: "delivered", meta: { readSource: "portal" }, read_at: "2026-09-18T00:00:00.000Z" });
    await updateMessageStatus(db, "resend", "re_1", "opened", at);
    expect(updates).toEqual([{ status: "opened", status_at: at }]);
  });
  it("a delivery is not a read", async () => {
    const { db, updates } = fakeDb({ id: "m1", account_id: "a1", status: "sent", meta: {}, read_at: null });
    await updateMessageStatus(db, "resend", "re_1", "delivered", at);
    expect(updates).toEqual([{ status: "delivered", status_at: at }]);
  });
  it("a status never goes backwards, so a late 'delivered' after an open writes nothing", async () => {
    const { db, updates } = fakeDb({ id: "m1", account_id: "a1", status: "opened", meta: {}, read_at: at });
    await updateMessageStatus(db, "resend", "re_1", "delivered", at);
    expect(updates).toEqual([]);
  });
});
