import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 7 Oct 2026 — PC Command:
 *  2. a change from Revise scope the CLIENT approves goes to the PAINTER on the job for
 *     their approval: "Variation approved by the client", the amount and the hours, Accept
 *     in big letters / Decline in small; a decline asks "please advise us of any further
 *     changes" and the change goes back to PC Command (console card + staff alert).
 *  1. a job parked at Quality check with no check on it moves on (25 Bunney Road).
 *  5. a client-updates note from PC Command lands on the job's timeline and on the
 *     customer's CRM record.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
let acceptId = "";
let declineId = "";
const token = () => `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

async function seedRevisionChange(workOrderId: string, comment: string, hours: number) {
  const { data, error } = await db!.from("wo_variations").insert({
    work_order_id: workOrderId, category: "extra_scope", comment, est_hours: hours,
    status: "priced", price_cents: 66_000, contractor_delta_cents: hours * 6_500, contractor_rate_cents: 6_500,
    revision_block_ref: `blk:${comment.length}`, customer_token: token(),
    priced_inputs: { surfaces: [{ key: `rev:${comment.length}`, heading: "Revision", label: comment }] },
  }).select("id, customer_token").single();
  if (error) throw new Error(`seed variation: ${error.message}`);
  return data as { id: string; customer_token: string };
}

test.describe("PC Command — the painter approves a client-approved change; QA with no checks moves on; client-update notes", () => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    if (!contractorId) throw new Error(`no contractors row for ${contractor!.email}`);
    fixture = await createLoopFixture(db!, contractorId, [{ heading: "Hall", labels: ["Walls"] }]);
    const a = await seedRevisionChange(fixture.workOrderId, "Paint the laundry ceiling as well", 3);
    const d = await seedRevisionChange(fixture.workOrderId, "Repaint the garage door frame", 2);
    acceptId = a.id; declineId = d.id;
    // The customer signs both (one offer each here — the token is the offer).
    for (const t of [a.customer_token, d.customer_token]) {
      const { data: r, error } = await db!.rpc("wo_customer_sign_variation", { p_token: t, p_name: "Casey Customer", p_signature: `data:image/png;base64,${"A".repeat(120)}` });
      if (error) throw new Error(error.message);
      expect(String(r)).toBe("ok:approved");
    }
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
  });

  test("a client-approved revision change with a painter on the job is RELEASED to them, not folded in", async () => {
    const { data } = await db!.from("wo_variations").select("id, status, released_at, contractor_accepted_at").in("id", [acceptId, declineId]);
    for (const v of data as { status: string; released_at: string | null; contractor_accepted_at: string | null }[]) {
      expect(v.status, "waits on the painter").toBe("customer_approved");
      expect(v.released_at, "released the moment the client signed").not.toBeNull();
      expect(v.contractor_accepted_at).toBeNull();
    }
    // Both approvals, in order: nothing moves while they wait (the gate), and the painter can decline only what is released.
    expect(await rpcAs(contractor!, "wo_contractor_decline_variation", { p_variation_id: declineId, p_note: "x" })).toBe("error:note_required");
  });

  test("the painter sees 'Variation approved by the client' with the amount and hours, accepts one in big letters and declines the other with a note", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    const approved = page.getByTestId(`approved-by-client-${acceptId}`);
    await expect(approved).toContainText(/Variation approved by the client/i);
    await expect(page.getByTestId(`approved-amount-${acceptId}`)).toHaveText("$195.00");
    await expect(page.getByTestId(`approved-hours-${acceptId}`)).toContainText("3 hrs");
    // The accept is the big one; Decline is a small text button.
    const acceptBtn = page.getByTestId(`accept-${acceptId}`);
    const declineBtn = page.getByTestId(`decline-${acceptId}`);
    const [a, d] = await Promise.all([acceptBtn.boundingBox(), declineBtn.boundingBox()]);
    expect(a!.height).toBeGreaterThan(d!.height * 1.5);
    const [aSize, dSize] = await Promise.all([
      acceptBtn.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      declineBtn.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ]);
    expect(aSize).toBeGreaterThan(dSize);

    await acceptBtn.click();
    await expect(page.getByTestId(`delta-${acceptId}`)).toContainText("$195.00 added", { timeout: 15_000 });

    // Decline the other: the note box opens, an empty note is refused, a real one goes.
    await page.getByTestId(`decline-${declineId}`).click();
    const box = page.getByTestId(`decline-box-${declineId}`);
    await expect(box).toContainText(/Please advise us of any further changes/i);
    await page.getByTestId(`decline-send-${declineId}`).click();
    await expect(page.locator(".var-msg, [data-testid='variation-message']").first()).toContainText(/Tell us what needs to change/i);
    await page.getByTestId(`decline-note-${declineId}`).fill("Two hours won't cover it — the frame needs sanding back to bare timber first. Four hours would.");
    await page.getByTestId(`decline-send-${declineId}`).click();
    await expect(page.getByTestId(`painter-declined-${declineId}`)).toContainText(/back with the office/i, { timeout: 15_000 });

    const { data: v } = await db!.from("wo_variations").select("status, contractor_declined_at, contractor_decline_note, declined_reason").eq("id", declineId).single();
    const row = v as { status: string; contractor_declined_at: string | null; contractor_decline_note: string; declined_reason: string | null };
    expect(row.status).toBe("declined");
    expect(row.contractor_declined_at).not.toBeNull();
    expect(row.contractor_decline_note).toContain("sanding back");
    // The approval's tick row (untouched) went with it; the accepted one's row stays.
    const { data: rows } = await db!.from("wo_surfaces").select("added_by_variation").eq("work_order_id", fixture!.workOrderId).not("added_by_variation", "is", null);
    expect((rows as { added_by_variation: string }[]).map((r) => r.added_by_variation)).toEqual([acceptId]);
    const { data: ev } = await db!.from("wo_events").select("type, meta").eq("work_order_id", fixture!.workOrderId).eq("type", "variation_contractor_declined");
    expect(ev).toHaveLength(1);
    // Declined by the painter, the gate no longer waits on it.
    const { data: waiting } = await db!.from("wo_variations").select("id").eq("work_order_id", fixture!.workOrderId).in("status", ["raised", "priced", "customer_approved"]);
    expect(waiting).toEqual([]);
  });

  test("the office sees the decline: a console card with the note, the job page names it, and the alert row was claimed", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.locator(".card, .qcard, [data-card-key]", { hasText: "Painter declined an approved change" }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(/sanding back/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);
    await expect(page.getByTestId(`variation-painter-declined-${declineId}`)).toContainText(/Declined by the painter/);
    const { data: claim } = await db!.from("staff_notifications").select("id").eq("event_key", "office_variation_declined").eq("entity_id", declineId);
    expect(claim, "the once-only alert was claimed (sent to whoever ticks it in Settings → Staff alerts)").toHaveLength(1);
  });

  test("a job parked at Quality check with NO check on it moves on when anyone looks (25 Bunney Road)", async () => {
    const { error } = await db!.from("work_orders").update({ stage: "qa", stage_entered_at: new Date().toISOString(), walkthrough_required: true }).eq("id", fixture!.workOrderId);
    if (error) throw new Error(error.message);
    const { count } = await db!.from("wo_qa_checks").select("id", { count: "exact", head: true }).eq("work_order_id", fixture!.workOrderId);
    expect(count).toBe(0);
    expect(await rpcAs(staff!, "wo_qa_route_passed", { p_work_order_id: fixture!.workOrderId })).toBe("ok:walkthrough");
    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", fixture!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("walkthrough");
    const { data: ev } = await db!.from("wo_events").select("meta").eq("work_order_id", fixture!.workOrderId).eq("type", "qa_passed_routed").order("created_at", { ascending: false }).limit(1);
    expect((ev as { meta: { checks: number; none_scheduled: boolean } }[])[0].meta).toMatchObject({ checks: 0, none_scheduled: true });
  });

  test("a waived job whose only check was a FAIL with no re-check (25 Bunney Road) routes the moment anyone looks", async () => {
    // Back to qa with a legacy fail: logged, no retry_of successor, and the office's waiver on the job.
    const { error: e1 } = await db!.from("work_orders").update({ stage: "qa", qa_waived: true, qa_required: false }).eq("id", fixture!.workOrderId);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await db!.from("wo_qa_checks").insert({ work_order_id: fixture!.workOrderId, kind: "final", result: "fail", checked_at: new Date().toISOString() });
    if (e2) throw new Error(e2.message);
    const { data: open } = await db!.rpc("wo_qa_open_count", { p_work_order_id: fixture!.workOrderId });
    expect(open, "a waived job has nothing open").toBe(0);
    // Without the waiver the fail holds, as before.
    await db!.from("work_orders").update({ qa_waived: false }).eq("id", fixture!.workOrderId);
    expect(await db!.rpc("wo_qa_open_count", { p_work_order_id: fixture!.workOrderId }).then((r) => r.data)).toBe(1);
    expect(await rpcAs(staff!, "wo_qa_route_passed", { p_work_order_id: fixture!.workOrderId })).toBe("ok:0");
    await db!.from("work_orders").update({ qa_waived: true }).eq("id", fixture!.workOrderId);
    expect(await rpcAs(staff!, "wo_qa_route_passed", { p_work_order_id: fixture!.workOrderId })).toBe("ok:walkthrough");
    // The fail stays on the record — history, not a hold.
    const { count } = await db!.from("wo_qa_checks").select("id", { count: "exact", head: true }).eq("work_order_id", fixture!.workOrderId).eq("result", "fail");
    expect(count).toBe(1);
  });

  test("a client-updates note from PC Command is on the job's timeline and on the customer's CRM record", async ({ page }) => {
    // Give the fixture's estimate a customer account so the CRM copy has somewhere to go.
    const { data: acc, error: accErr } = await db!.from("accounts").insert({ email: `pc.note.${Date.now()}@example.com`, name: "Note Customer" }).select("id").single();
    if (accErr) throw new Error(accErr.message);
    const accountId = (acc as { id: string }).id;
    await db!.from("estimates").update({ account_id: accountId }).eq("id", fixture!.estimateId);
    try {
      await signIn(page, staff!, /\/(home|estimates)/);
      await page.goto(`/pc/wo/${fixture!.workOrderId}`);
      await expect(page.getByTestId("client-updates")).toBeVisible();
      await page.getByTestId("client-note-body").fill("Rang the customer — happy with the hall, told them the laundry ceiling is Thursday.");
      await page.getByTestId("client-note-save").click();
      await expect(page.getByTestId("client-note-msg")).toContainText(/job's timeline and on the customer's CRM record/i, { timeout: 15_000 });
      await expect(page.getByTestId("client-timeline-note").first()).toContainText(/laundry ceiling is Thursday/);
      const { data: ev } = await db!.from("wo_events").select("meta").eq("work_order_id", fixture!.workOrderId).eq("type", "client_update_note");
      expect(ev).toHaveLength(1);
      const { data: crm } = await db!.from("crm_events").select("type, payload").eq("account_id", accountId).eq("type", "note_added");
      expect(crm).toHaveLength(1);
      expect((crm as { payload: { body: string; origin: string } }[])[0].payload).toMatchObject({ origin: "client_update" });
      expect((crm as { payload: { body: string } }[])[0].payload.body).toContain("laundry ceiling is Thursday");
      // And the CRM record shows it.
      await page.goto(`/crm/customers/${accountId}`);
      await expect(page.locator("body")).toContainText(/laundry ceiling is Thursday/, { timeout: 30_000 });
    } finally {
      await db!.from("crm_events").delete().eq("account_id", accountId);
      await db!.from("estimates").update({ account_id: null }).eq("id", fixture!.estimateId);
      await db!.from("accounts").delete().eq("id", accountId);
    }
  });
});
