import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Session 3 of the messaging brief (16 Sep 2026) — money and sign-off
 * reminders, driven through the real half-hour sweep route.
 *
 *   an issued invoice 2 days past due → reminder 1 lands in the approval
 *   queue (office approves first) · a payment stops the ladder: the next
 *   rung is claimed with "Paid." and nothing new is queued · a dispute hold
 *   pauses it the same way · a delivered completion pack → the DB ladder's
 *   0 h rung is sent (or held for sending hours) exactly once, and never
 *   mentions deemed sign-off.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";

let f: LoopFixture | null = null;
let invoiceId = "";
const stamp = Date.now().toString(36);

const cleanup = async () => {
  if (!db || process.env.E2E_KEEP) return;
  if (invoiceId) {
    await db.from("automation_holds").delete().eq("invoice_id", invoiceId);
    await db.from("messages").delete().eq("invoice_id", invoiceId);
    await db.from("automation_claims").delete().eq("entity_id", invoiceId);
    await db.from("payments").delete().eq("invoice_id", invoiceId);
    await db.from("invoice_events").delete().eq("invoice_id", invoiceId);
    await db.from("invoices").delete().eq("id", invoiceId);
  }
  if (f) {
    await db.from("automation_holds").delete().eq("work_order_id", f.workOrderId);
    await db.from("automation_claims").delete().eq("entity_id", f.workOrderId);
    await db.from("wo_checklist_items").delete().eq("work_order_id", f.workOrderId);
    await db.from("messages").delete().eq("work_order_id", f.workOrderId);
    await destroyLoopFixture(db, f);
  }
};

test.describe("money and sign-off reminders", () => {
  test.setTimeout(240_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db || !SECRET, "set SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET");

  test.beforeAll(async () => {
    const cid = await contractorIdForEmail(db!, contractor!.email);
    f = await createLoopFixture(db!, cid!, [{ heading: "Living", labels: ["Walls"] }]);
    // A contact on the estimate, so the reminders have somewhere to go.
    await db!.from("estimates").update({
      accepted_name: "Hold E2E", sent_snapshot: { jobAddress: "1 Test St, Thornbury", contactEmail: `holly.${stamp}@hold-reminders.invalid` },
      builder_state: { contact: { first_name: "Holly", email: `holly.${stamp}@hold-reminders.invalid`, phone: "0400000000" } },
    }).eq("id", f.estimateId);
    const due = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const issued = new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await db!.from("invoices").insert({
      estimate_id: f.estimateId, work_order_id: f.workOrderId, kind: "progress", status: "issued", number: `INV-E2E${stamp.slice(-4)}`,
      subtotal_ex_cents: 100_000, gst_cents: 10_000, total_inc_cents: 110_000, amount_cents: 110_000, issued_on: issued, due_on: due,
      token: `e2e-rem-${stamp}-${Math.random().toString(36).slice(2, 14)}`,
    }).select("id").single();
    if (error) throw error;
    invoiceId = data!.id as string;
  });
  test.afterAll(cleanup);

  const sweep = async (request: Parameters<Parameters<typeof test>[2]>[0]["request"]) => {
    const res = await request.get("/api/cron/campaign-sweep?only=reminders", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.ok()).toBe(true);
    return (await res.json()) as { reminders: { invoices: { fired: number; stopped: number }; signoff: { fired: number; nudged: number } } };
  };

  test("an overdue invoice queues reminder 1 for approval; a payment stops the ladder; a hold pauses it", async ({ request, page }) => {
    const first = await sweep(request);
    expect(first.reminders.invoices.fired).toBeGreaterThanOrEqual(1);
    const { data: holds } = await db!.from("automation_holds").select("id, status, reason, channels, subject, sms_body").eq("invoice_id", invoiceId);
    expect(holds).toHaveLength(1);
    expect(holds![0].status).toBe("pending");
    expect(holds![0].reason).toBe("approve");
    expect(holds![0].channels).toEqual(["email"]);           // rung 1 is email only
    expect(holds![0].subject).toMatch(/reminder/i);
    expect(holds![0].sms_body).toBeNull();
    const { data: claim } = await db!.from("automation_claims").select("rung").eq("automation_key", "invoice_reminder").eq("entity_id", invoiceId);
    expect(claim!.map((c) => c.rung)).toEqual(["rung1"]);

    // Same half hour again: nothing new.
    await sweep(request);
    const { count } = await db!.from("automation_holds").select("id", { count: "exact", head: true }).eq("invoice_id", invoiceId);
    expect(count).toBe(1);

    // Move the due date back so rung 2 is due, then pay it: the rung is claimed with the reason, nothing queued.
    await db!.from("invoices").update({ due_on: new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10) }).eq("id", invoiceId);
    await db!.from("payments").insert({ invoice_id: invoiceId, amount_cents: 110_000, paid_on: new Date().toISOString().slice(0, 10), method: "bank_transfer", status: "succeeded" });
    const paid = await sweep(request);
    expect(paid.reminders.invoices.fired).toBe(0);
    const { count: after } = await db!.from("automation_holds").select("id", { count: "exact", head: true }).eq("invoice_id", invoiceId);
    expect(after).toBe(1);
    // The pending reminder 1, approved from the queue now, is refused: no longer needed.
    const { data: hold } = await db!.from("automation_holds").select("id").eq("invoice_id", invoiceId).single();
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/crm/messages/queue");
    await page.getByTestId(`hold-${hold!.id}`).getByTestId("approve-one").click();
    await expect(page.getByTestId("queue-said")).toContainText("no longer needed", { timeout: 20_000 });
    const { data: skipped } = await db!.from("automation_holds").select("status, result").eq("id", hold!.id).single();
    expect(skipped!.status).toBe("skipped");
    expect(JSON.stringify(skipped!.result)).toMatch(/Paid/);

    // A dispute hold pauses reminders on an unpaid invoice.
    await db!.from("payments").delete().eq("invoice_id", invoiceId);
    await db!.from("automation_claims").delete().eq("entity_id", invoiceId);
    await db!.from("invoices").update({ chase_hold_reason: "Disputed the trim price" }).eq("id", invoiceId);
    const held = await sweep(request);
    expect(held.reminders.invoices.fired).toBe(0);
    const { data: claimsNow } = await db!.from("automation_claims").select("rung").eq("entity_id", invoiceId);
    expect(claimsNow).toHaveLength(0);
  });

  test("a delivered completion pack sends the 0 h sign-off reminder once, in the approved wording", async ({ request }) => {
    // The two gates before a walkthrough (wo-signoff.spec): every surface done, prep list ticked.
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f!.workOrderId);
    await completePrep(db!, staff!, f!.workOrderId);
    await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: f!.workOrderId, p_to: "completion_prep" });
    const r = await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: f!.workOrderId });
    expect(String(r)).toMatch(/^ok:/);
    const s1 = await sweep(request);
    expect(s1.reminders.signoff.fired).toBeGreaterThanOrEqual(1);
    const { data: ev } = await db!.from("wo_events").select("id, meta").eq("work_order_id", f!.workOrderId).eq("type", "signoff_nudge");
    expect(ev).toHaveLength(1);
    expect(String((ev![0].meta as { copy: string }).copy)).not.toMatch(/treated as signed/);
    // Sent now, or held for sending hours — either way recorded once, never twice.
    const [{ data: msgs }, { data: holds }] = await Promise.all([
      db!.from("messages").select("id").eq("work_order_id", f!.workOrderId).filter("meta->>automation", "eq", "signoff_reminder"),
      db!.from("automation_holds").select("id").eq("work_order_id", f!.workOrderId).eq("automation_key", "signoff_reminder"),
    ]);
    expect((msgs?.length ?? 0) + (holds?.length ?? 0)).toBeGreaterThanOrEqual(1);
    await sweep(request);
    const [{ data: msgs2 }, { data: holds2 }] = await Promise.all([
      db!.from("messages").select("id").eq("work_order_id", f!.workOrderId).filter("meta->>automation", "eq", "signoff_reminder"),
      db!.from("automation_holds").select("id").eq("work_order_id", f!.workOrderId).eq("automation_key", "signoff_reminder"),
    ]);
    expect((msgs2?.length ?? 0) + (holds2?.length ?? 0)).toBe((msgs?.length ?? 0) + (holds?.length ?? 0));
  });
});
