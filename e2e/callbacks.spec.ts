import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Call backs, Step 3: one record, four ways in (rulings C1–C11, ⚑15, ⚑22).
 *
 * AS PC: route 3 (Customer called back) through the job page; route 1 (a
 * failed quality check) through the check card; route 2 (a flagged
 * walk-through) from the queue card into the job page; route 4 (the
 * scheduler) through the RPC the board's tick box calls — a visit on a job
 * with a call back already open joins it. AS THE PAINTER: the card says what
 * is wrong and when to go back, and marks it fixed with a photo. THEN: only the
 * PC's close ends it; invoice chasing pauses on log and resumes on close; the
 * Flow column is in the DOM only while one is open; the record names the
 * painter who did the job even when someone else is booked to fix it; a
 * painter cannot close one; only the owner can void one.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const melb = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const TOMORROW = melb(new Date(Date.now() + 86_400_000));

let contractorId = "";
let otherPainterId: string | null = null;
let closedJob: LoopFixture | null = null;   // signed off: routes 3 and 4
let qaJob: LoopFixture | null = null;       // at its quality check: route 1
let flaggedJob: LoopFixture | null = null;  // flagged at the walk-through: route 2
let invoiceId = "";
let callbackId = "";

async function callbacksOn(workOrderId: string) {
  const { data, error } = await db!.from("wo_callbacks").select("id, painter_id, fixed_by_painter_id, source, reason, reported_on, status, appointment_id, qa_check_id, description").eq("work_order_id", workOrderId).order("created_at");
  expect(error?.message ?? "").toBe("");
  return (data ?? []) as { id: string; painter_id: string; fixed_by_painter_id: string | null; source: string; reason: string; reported_on: string; status: string; appointment_id: string | null; qa_check_id: string | null; description: string }[];
}
async function holdOn(id: string) {
  const { data } = await db!.from("invoices").select("chase_hold_reason, chase_hold_kind").eq("id", id).single();
  return data as { chase_hold_reason: string | null; chase_hold_kind: string | null };
}
async function openPc(page: Page, workOrderId: string) {
  await page.goto(`/pc/wo/${workOrderId}`);
  await expect(page.getByTestId("callbacks")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.describe("call backs — one record, four ways in", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    // Another active painter, for "someone else fixes it" (C7).
    const { data: others } = await db!.from("contractors").select("id").eq("active", true).neq("id", contractorId).limit(1);
    otherPainterId = ((others ?? []) as { id: string }[])[0]?.id ?? null;

    closedJob = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "closed", status: "complete", start_date: "2026-09-28", end_date: "2026-09-30" }).eq("id", closedJob.workOrderId);
    await db!.from("wo_signoff").upsert({ work_order_id: closedJob.workOrderId, signed_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), signed_name: "E2E Customer", signed_kind: "in_person", areas: {} }, { onConflict: "work_order_id" });
    const stamp = Date.now().toString(36);
    const inv = await db!.from("invoices").insert({
      estimate_id: closedJob.estimateId, work_order_id: closedJob.workOrderId, kind: "final", status: "issued", number: `INV-CB${stamp.slice(-4)}`,
      subtotal_ex_cents: 100_000, gst_cents: 10_000, total_inc_cents: 110_000, amount_cents: 110_000, issued_on: "2026-10-01", due_on: "2026-10-05",
      token: `e2e-cb-${stamp}-${Math.random().toString(36).slice(2, 14)}`,
    }).select("id").single();
    expect(inv.error?.message ?? "").toBe("");
    invoiceId = (inv.data as { id: string }).id;

    qaJob = await createLoopFixture(db!, contractorId, [{ heading: "Hall", labels: ["Walls"] }]);
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", qaJob.workOrderId);
    await db!.from("work_orders").update({ stage: "qa" }).eq("id", qaJob.workOrderId);
    await db!.from("wo_qa_checks").insert({ work_order_id: qaJob.workOrderId, kind: "final" });

    flaggedJob = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "in_progress" }).eq("id", flaggedJob.workOrderId);
    await db!.from("wo_signoff").upsert({ work_order_id: flaggedJob.workOrderId, evidence_pack_sent_at: new Date().toISOString(), areas: { Front: { flagged_at: new Date().toISOString(), note: "Paint on the window glass" } } }, { onConflict: "work_order_id" });
  });

  test.afterAll(async () => {
    if (!db) return;
    for (const f of [closedJob, qaJob, flaggedJob]) await destroyLoopFixture(db, f);
  });

  test("route 3 — Customer called back: one record, the painter who did the job, a return visit for someone else, invoice chasing paused", async ({ page }) => {
    test.setTimeout(120_000);
    expect((await holdOn(invoiceId)).chase_hold_reason).toBeNull();
    await signIn(page, staff!, /\/(home|estimates)/);
    await openPc(page, closedJob!.workOrderId);
    await page.getByTestId("callback-customer-called").click();
    await expect(page.getByTestId("callback-form")).toHaveAttribute("data-source", "customer_call");
    await expect(page.getByTestId("callback-reported-on")).toHaveValue(melb(new Date()));
    await page.getByTestId("callback-description").fill("Paint on the lounge window glass. Customer sent 2 photos.");
    await expect(page.getByTestId("callback-reason-workmanship")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("callback-return-start").fill(TOMORROW);
    if (otherPainterId) await page.getByTestId("callback-fixer").selectOption(otherPainterId);
    await page.getByTestId("callback-log").click();
    await expect(page.getByTestId("callback-msg")).toContainText(/Call back logged/);

    const rows = await callbacksOn(closedJob!.workOrderId);
    expect(rows).toHaveLength(1);
    callbackId = rows[0].id;
    expect(rows[0]).toMatchObject({ source: "customer_call", reason: "workmanship", reported_on: melb(new Date()), status: "booked", painter_id: contractorId });
    if (otherPainterId) expect(rows[0].fixed_by_painter_id).toBe(otherPainterId);
    expect(rows[0].appointment_id).toBeTruthy();
    const { data: appt } = await db!.from("wo_appointments").select("contractor_id, start_date, note").eq("id", rows[0].appointment_id!).single();
    expect((appt as { start_date: string }).start_date).toBe(TOMORROW);
    expect((appt as { contractor_id: string }).contractor_id).toBe(otherPainterId ?? contractorId);
    // C10: chasing paused, with the kind a close will clear.
    expect(await holdOn(invoiceId)).toEqual({ chase_hold_reason: expect.stringMatching(/Call back open/), chase_hold_kind: "call_back" });
    // C9: the Flow column exists now, with the tag.
    await page.goto("/pc/flow");
    await expect(page.getByTestId("lane-callbacks")).toBeVisible();
    await expect(page.getByTestId(`callback-job-${closedJob!.workOrderId}`)).toContainText("Invoice chasing paused");
    // The job was never reopened.
    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", closedJob!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("closed");
  });

  test("the painter sees what is wrong and when, cannot close it, and marks it fixed with a photo", async ({ page }) => {
    test.setTimeout(120_000);
    // The painter who did the job always sees it (C7), whoever is booked to fix it.
    await signIn(page, contractor!, /\/portal/);
    await expect(page.getByTestId(`home-callback-${callbackId}`)).toBeVisible();
    await page.goto(`/portal/jobs/${closedJob!.workOrderId}`);
    const card = page.getByTestId(`callback-${callbackId}`);
    await expect(card).toHaveAttribute("data-status", "booked");
    await expect(page.getByTestId(`callback-what-${callbackId}`)).toContainText("Paint on the lounge window glass");
    await expect(page.getByTestId(`callback-visit-${callbackId}`)).toContainText(/Return visit:/);

    // Only the PC's close ends it (⚑22).
    expect(await rpcAs(contractor!, "wo_callback_close", { p_callback_id: callbackId, p_note: "" })).toBe("error:not_staff");
    // A photo is required to mark it fixed.
    expect(await rpcAs(contractor!, "wo_callback_mark_fixed", { p_callback_id: callbackId, p_note: "", p_photo_ids: [] })).toBe("error:photo_required");

    await page.getByTestId(`callback-fix-${callbackId}`).click();
    await page.getByTestId(`callback-fix-file-${callbackId}`).setInputFiles({ name: "fixed.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId(`callback-fix-photo-${callbackId}`)).toContainText(/1 photo added/, { timeout: 60_000 });
    await page.getByTestId(`callback-fix-save-${callbackId}`).click();
    await expect(page.getByTestId(`callback-${callbackId}`)).toHaveAttribute("data-status", "fixed");
    const rows = await callbacksOn(closedJob!.workOrderId);
    expect(rows[0].status).toBe("fixed");
    const { data: photos } = await db!.from("wo_photos").select("id, kind").eq("callback_id", callbackId);
    expect((photos ?? []).length).toBeGreaterThanOrEqual(1);
  });

  test("PC: the 'marked fixed' card, confirm and close — chasing resumes and the column goes", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.locator(`[data-testid^="callback-card-callback_fixed:work_order:${closedJob!.workOrderId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("marked the call back");
    await card.getByTestId(/callback-card-open-/).click();
    await expect(page).toHaveURL(new RegExp(`/pc/wo/${closedJob!.workOrderId}`));
    await page.getByTestId(`callback-close-${callbackId}`).click();
    await expect(page.getByTestId("callback-msg")).toContainText(/Closed/);
    const rows = await callbacksOn(closedJob!.workOrderId);
    expect(rows[0].status).toBe("done");
    expect(await holdOn(invoiceId)).toEqual({ chase_hold_reason: null, chase_hold_kind: null });
    await page.goto("/pc/flow");
    await expect(page.getByTestId("lane-callbacks")).toHaveCount(0);
    await expect(page.getByTestId(`callback-tag-${closedJob!.workOrderId}`)).toHaveCount(0);
  });

  test("route 1 — a failed quality check asks 'rectify today, or a call back?'", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${qaJob!.workOrderId}`);
    const { data: chk } = await db!.from("wo_qa_checks").select("id").eq("work_order_id", qaJob!.workOrderId).is("result", null).single();
    const checkId = (chk as { id: string }).id;
    await page.getByTestId(`qa-fail-${checkId}`).click();
    await page.getByTestId(`qa-what-${checkId}`).fill("Filler not sanded flat on the hall wall");
    await page.getByTestId(`qa-confirm-fail-${checkId}`).click();
    await expect(page.getByTestId(`qa-callback-ask-${checkId}`)).toBeVisible();
    await page.getByTestId(`qa-callback-date-${checkId}`).fill(TOMORROW);
    await page.getByTestId(`qa-callback-yes-${checkId}`).click();
    await expect(page.getByTestId(`qa-callback-done-${checkId}`)).toContainText(/Call back logged/);
    const rows = await callbacksOn(qaJob!.workOrderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "qc_fail", reason: "workmanship", reported_on: melb(new Date()), status: "booked", qa_check_id: checkId, painter_id: contractorId });
    expect(rows[0].description).toContain("Filler not sanded flat");
    // The check itself is still a failed check (C4).
    const { data: after } = await db!.from("wo_qa_checks").select("result").eq("id", checkId).single();
    expect((after as { result: string }).result).toBe("fail");
  });

  test("route 2 — a flagged walk-through is a queue card; 'Yes, call back' logs it and the sign-off says failed_callback", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.locator(`[data-testid^="callback-card-walkthrough_flagged:work_order:${flaggedJob!.workOrderId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Is a call back required?");
    await card.getByTestId(/callback-card-open-/).click();
    await expect(page).toHaveURL(/callback=walkthrough_fail/);
    await expect(page.getByTestId("callback-form")).toHaveAttribute("data-source", "walkthrough_fail");
    await expect(page.getByTestId("callback-description")).toHaveValue(/Flagged at the walk-through: Front/);
    await page.getByTestId("callback-return-start").fill(TOMORROW);
    await page.getByTestId("callback-log").click();
    await expect(page.getByTestId("callback-msg")).toContainText(/Call back logged/);
    const rows = await callbacksOn(flaggedJob!.workOrderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "walkthrough_fail", reason: "workmanship", status: "booked" });
    const { data: so } = await db!.from("wo_signoff").select("outcome").eq("work_order_id", flaggedJob!.workOrderId).single();
    expect((so as { outcome: string | null }).outcome).toBe("failed_callback");
    // The card has cleared itself.
    await page.goto("/pc");
    await expect(page.locator(`[data-testid^="callback-card-walkthrough_flagged:work_order:${flaggedJob!.workOrderId}"]`)).toHaveCount(0);
  });

  test("route 4 — a scheduler visit ticked as a call back joins the open one; on a clean job it makes one; the reason can change; a painter's reason change and void are refused", async () => {
    // The closed job's call back is done; a scheduler visit opens a new one.
    const made = String(await rpcAs(staff!, "wo_callback_log", {
      p_work_order_id: closedJob!.workOrderId, p_source: "scheduler", p_reason: "workmanship", p_reported_on: null,
      p_description: "Touch up the skirting", p_photo_ids: [], p_return_start: TOMORROW, p_return_end: TOMORROW, p_fixed_by: null, p_qa_check_id: null,
    }));
    expect(made).toMatch(/^ok:[0-9a-f-]{36}$/);
    const first = made.slice(3);
    // A second scheduler visit while it is open JOINS it — never a second record.
    const joined = String(await rpcAs(staff!, "wo_callback_log", {
      p_work_order_id: closedJob!.workOrderId, p_source: "scheduler", p_reason: "workmanship", p_reported_on: null,
      p_description: "", p_photo_ids: [], p_return_start: TOMORROW, p_return_end: TOMORROW, p_fixed_by: null, p_qa_check_id: null,
    }));
    expect(joined).toBe(`ok:${first}:attached`);
    const rows = await callbacksOn(closedJob!.workOrderId);
    expect(rows.filter((r) => r.status !== "done")).toHaveLength(1);
    expect(rows.find((r) => r.id === first)).toMatchObject({ source: "scheduler", status: "booked", painter_id: contractorId });

    // ⚑15: the PC changes the reason; a painter cannot.
    expect(await rpcAs(staff!, "wo_callback_set_reason", { p_callback_id: first, p_reason: "not_workmanship", p_note: "customer's own damage" })).toBe("ok:not_workmanship");
    expect(await rpcAs(contractor!, "wo_callback_set_reason", { p_callback_id: first, p_reason: "workmanship", p_note: "" })).toBe("error:not_staff");
    // Only the owner voids. Whichever this staff login is, the answer is the rule's.
    const owner = await rpcAs(staff!, "has_dashboard_role", { p_roles: ["owner"] });
    const voided = await rpcAs(staff!, "wo_callback_void", { p_callback_id: first, p_reason: "logged in error" });
    expect(voided).toBe(owner === "true" ? "ok:void" : "error:not_owner");
    expect(await rpcAs(contractor!, "wo_callback_void", { p_callback_id: first, p_reason: "x" })).toBe("error:not_staff");
    if (owner === "true") expect(await holdOn(invoiceId)).toEqual({ chase_hold_reason: null, chase_hold_kind: null });
  });
});
