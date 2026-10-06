import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds } from "./helpers";
import { completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 6 Oct 2026 — 568 Collins Street: passing the last quality check routed
 * the job to its no-walkthrough close, which drafts the final invoice, which
 * wrote a line for a signed variation that was ALREADY on an issued progress
 * invoice. `invoice_lines_variation_once` (§3.1) refused, and the whole pass
 * rolled back with it. The close must skip a variation another live invoice
 * already carries — the ledger has netted what that invoice took.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;
let variationId = "";

test.describe("the final invoice skips a variation already billed", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("estimates").update({ total_cents: 1_100_000, sent_snapshot: { totals: { totalCents: 1_100_000 }, gstRatePct: 10, areas: [], lines: [], options: [] } }).eq("id", job.estimateId);
    await db!.from("work_orders").update({ stage: "completion_prep", walkthrough_required: false }).eq("id", job.workOrderId);
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", job.workOrderId);
    await completePrep(db!, staff!, job.workOrderId);

    const { data: v, error: vErr } = await db!.from("wo_variations").insert({
      work_order_id: job.workOrderId, category: "extra_scope", comment: "Extra coat on the hall",
      status: "customer_approved", customer_responded_at: new Date().toISOString(), price_cents: 55_000,
    }).select("id").single();
    if (vErr) throw new Error(`variation: ${vErr.message}`);
    variationId = (v as { id: string }).id;

    // The variation already billed: a progress invoice carrying its line, issued.
    const { data: inv, error: iErr } = await db!.from("invoices").insert({
      estimate_id: job.estimateId, work_order_id: job.workOrderId, kind: "progress", status: "draft",
      amount_cents: 55_000, subtotal_ex_cents: 50_000, gst_cents: 5_000, total_inc_cents: 55_000,
      token: `e2evar${Date.now()}${process.pid}`,
    }).select("id").single();
    if (iErr) throw new Error(`progress invoice: ${iErr.message}`);
    const progressId = (inv as { id: string }).id;
    const { error: lErr } = await db!.from("invoice_lines").insert({
      invoice_id: progressId, sort: 0, source: "variation", source_ref: variationId,
      description: "Extra coat on the hall", amount_ex_cents: 50_000,
    });
    if (lErr) throw new Error(`progress line: ${lErr.message}`);
    const issued = await rpcAs(staff!, "invoice_issue", { p_invoice_id: progressId });
    if (!String(issued).startsWith("ok")) throw new Error(`issue: ${String(issued)}`);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("closing without a walkthrough drafts the final with ONE live line for the variation", async () => {
    const closed = await rpcAs(staff!, "wo_close_without_walkthrough", { p_work_order_id: job!.workOrderId });
    expect(String(closed)).toBe("ok:closed");

    const { data: stage } = await db!.from("work_orders").select("stage").eq("id", job!.workOrderId).single();
    expect((stage as { stage: string }).stage).toBe("closed");

    const { data: finals } = await db!.from("invoices").select("id").eq("estimate_id", job!.estimateId).eq("kind", "final").eq("status", "draft");
    expect((finals ?? []).length).toBe(1);

    const { data: lines } = await db!.from("invoice_lines").select("invoice_id, parent_void").eq("source", "variation").eq("source_ref", variationId);
    const live = ((lines ?? []) as { invoice_id: string; parent_void: boolean }[]).filter((l) => !l.parent_void);
    expect(live.length).toBe(1);
    expect(live[0].invoice_id).not.toBe(((finals ?? []) as { id: string }[])[0].id);
  });
});
