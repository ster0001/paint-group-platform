import type { SupabaseClient } from "@supabase/supabase-js";
import { melbourneDatePlus } from "../../lib/time/workingDays";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, type LoopFixture } from "./woLoop";

/**
 * Fixture jobs for the Payments page specs (payments-merge brief). One job =
 * an accepted estimate + work order at a stage, with the invoices and payments
 * asked for, found on the page by `${stamp} ${label} St` in its address.
 * Everything made is removed by `cleanupPaymentsJobs` — including invoices,
 * payments and events the spec's own actions created on those jobs.
 */
export type PaymentsJob = { f: LoopFixture; label: string; address: string };
export type FixtureInvoice = { kind: string; status: string; total: number; due: string | null; paid?: boolean };

/** The Melbourne calendar day n days from today — the app's own day (never the UTC one). */
export const isoDay = (offsetDays: number) => melbourneDatePlus(new Date(), offsetDays);

export async function makePaymentsJob(
  db: SupabaseClient, contractorEmail: string, stamp: string, label: string,
  opts: { contractCents: number; stage: string; startDate?: string | null; invoices?: FixtureInvoice[] },
): Promise<PaymentsJob> {
  const cid = await contractorIdForEmail(db, contractorEmail);
  const f = await createLoopFixture(db, cid!, [{ heading: "Front", labels: ["Walls"] }]);
  const address = `${stamp} ${label} St, Testville`;
  const { error: estErr } = await db.from("estimates").update({
    accepted_name: `${label} Customer`, accepted_total_cents: opts.contractCents, total_cents: opts.contractCents,
    sent_snapshot: { jobAddress: address, contactEmail: `${label.toLowerCase()}.${stamp.toLowerCase()}@payments-e2e.invalid` },
    // The chat reply (Payments → Message) notifies this contact: an .invalid address, no phone — nothing can be delivered.
    builder_state: { contact: { first_name: label, email: `${label.toLowerCase()}.${stamp.toLowerCase()}@payments-e2e.invalid`, phone: "" } },
  }).eq("id", f.estimateId);
  if (estErr) throw estErr;
  // Only the STAGE moves: work_orders.status is a different enum (draft/issued/in_progress/complete).
  const { error: woErr } = await db.from("work_orders").update({ stage: opts.stage, start_date: opts.startDate ?? null }).eq("id", f.workOrderId);
  if (woErr) throw woErr;
  for (const [n, i] of (opts.invoices ?? []).entries()) {
    const issued = i.status !== "draft";
    const { data, error } = await db.from("invoices").insert({
      estimate_id: f.estimateId, work_order_id: f.workOrderId, kind: i.kind, status: i.status,
      number: issued ? `INV-${stamp}${n}${label.slice(0, 3)}` : null,
      subtotal_ex_cents: Math.round(i.total / 1.1), gst_cents: i.total - Math.round(i.total / 1.1), total_inc_cents: i.total, amount_cents: i.total,
      issued_on: issued ? isoDay(-20) : null, due_on: i.due,
      token: `e2e-pm-${stamp}-${label}-${n}-${Math.random().toString(36).slice(2, 10)}`,
    }).select("id").single();
    if (error) throw error;
    if (i.kind === "deposit" || i.kind === "progress") {
      await db.from("invoice_lines").insert({ invoice_id: data!.id, sort: 0, source: "manual", description: `${i.kind} line`, amount_ex_cents: Math.round(i.total / 1.1), gst_cents: i.total - Math.round(i.total / 1.1) });
    }
    if (i.paid) {
      const { error: pe } = await db.from("payments").insert({ invoice_id: data!.id, amount_cents: i.total, method: "bank_transfer", status: "succeeded", paid_on: isoDay(-10) });
      if (pe) throw pe;
    }
  }
  return { f, label, address };
}

export async function cleanupPaymentsJobs(db: SupabaseClient, jobs: readonly PaymentsJob[]): Promise<void> {
  for (const j of jobs) {
    const { data } = await db.from("invoices").select("id").eq("estimate_id", j.f.estimateId);
    const ids = (data ?? []).map((r) => (r as { id: string }).id);
    if (ids.length) {
      await db.from("messages").delete().in("invoice_id", ids);
      await db.from("automation_holds").delete().in("invoice_id", ids);
      await db.from("payments").delete().in("invoice_id", ids);
      await db.from("invoice_events").delete().in("invoice_id", ids);
      await db.from("invoice_lines").delete().in("invoice_id", ids);
      await db.from("invoices").delete().in("id", ids);
    }
    await db.from("estimate_messages").delete().eq("estimate_id", j.f.estimateId);
    await db.from("estimate_events").delete().eq("estimate_id", j.f.estimateId);
    await db.from("messages").delete().eq("estimate_id", j.f.estimateId);
    await destroyLoopFixture(db, j.f);
  }
}
