import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { accessTokenFor, contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Painter status Step 7 — what the colour changes (brief §10 Step 7; R11, R12,
 * R17; ⚑7, ⚑8, ⚑13, ⚑14, ⚑23; Tom 8 Oct 2026 on how a bonus is paid).
 *
 * AS PC / OWNER (the E2E staff login is the owner): an offer to a Red painter
 * fails at the RPC and at the table until the owner records the clearance; a
 * Red employee cannot be set as lead; a Green painter's sign-off draft is due
 * exactly 3 business days later across a weekend; the PC's hold puts it on the
 * default date, never later, raises the queue card, and release puts it back;
 * a bonus review shows as a card, "Tell Tom" hands it over, approve is
 * refused while the switch is off and works when on; the lane carries the
 * colour. AS THE CONTRACTOR: the approved amount shows with Claim now, and the
 * claim raises a submitted contractor invoice through the normal channel. AS
 * THE CUSTOMER: nothing. The payroll CSV carries an employed lead's bonus.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const run = Date.now().toString(36);
const employee = { email: `pg.e2e.employee.${run}.lead@example.com`, password: `Employee-${run}-pw!` };
let employeeUserId = "";
let employeeId = "";
let contractorId = "";
let offerJob: LoopFixture | null = null;
let payJob: LoopFixture | null = null;
let savedRules: Record<string, unknown> | null = null;
let savedProfile: Record<string, unknown> | null = null;
let bonusId = "";
let ciId = "";

async function readAs(who: { email: string; password: string }, path: string): Promise<unknown[]> {
  const token = await accessTokenFor(who);
  const body = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
  expect(Array.isArray(body), JSON.stringify(body)).toBe(true);
  return body as unknown[];
}
async function setColour(painterId: string, colour: string) {
  const { error } = await db!.from("painter_status").upsert({
    painter_id: painterId, colour, streak: colour === "green" ? 4 : 0, best_streak: 4, bonus_counter: 0, line: `E2E ${colour}`,
    measures: { checks: { passedFirstTime: 1, done: 1, band: "yellow" }, reminders: { answered: 1, scored: 1, creditsApplied: 0, band: "yellow" }, callbacks: { scored: 0, band: "yellow" } },
    offers_cleared_at: null, offers_cleared_by: null, offers_cleared_reason: "", computed_at: new Date().toISOString(),
  }, { onConflict: "painter_id" });
  expect(error?.message ?? "").toBe("");
}
async function ci(id: string) {
  const { data, error } = await db!.from("contractor_invoices").select("id, status, due_on, terms_kind, terms_hold_reason, total_inc_cents, auto_draft_source, lines").eq("id", id).single();
  expect(error?.message ?? "").toBe("");
  return data as { id: string; status: string; due_on: string; terms_kind: string; terms_hold_reason: string; total_inc_cents: number; auto_draft_source: string; lines: { label: string; cents: number }[] };
}
async function bonus(id: string) {
  const { data, error } = await db!.from("painter_bonuses").select("status, amount_cents, handed_over_at, payment_ref").eq("id", id).single();
  expect(error?.message ?? "").toBe("");
  return data as { status: string; amount_cents: number | null; handed_over_at: string | null; payment_ref: string };
}
async function pcQueue(page: Page) {
  await page.goto("/pc");
  await expect(page.getByTestId("queue")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.describe("what the colour changes — offers, payment terms, bonus", () => {
  test.skip(!contractor || !staff || !customer, missingCreds("CUSTOMER"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    const { data: rules } = await db!.from("settings").select("value").eq("key", "painter_status_rules").maybeSingle();
    savedRules = ((rules as { value: Record<string, unknown> } | null)?.value) ?? null;
    expect(savedRules, "painter_status_rules must exist").not.toBeNull();
    await db!.from("settings").update({ value: { ...savedRules, bonusApprovalsEnabled: false } }).eq("key", "painter_status_rules");
    // The claim needs a complete profile; put it back afterwards.
    const { data: prof } = await db!.from("contractors").select("company_name, abn, address, gst_registered").eq("id", contractorId).single();
    savedProfile = (prof as Record<string, unknown>) ?? null;
    await db!.from("contractors").update({ company_name: "E2E Painting", abn: "12 345 678 901", address: "1 Test St, Melbourne", gst_registered: false }).eq("id", contractorId);

    offerJob = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "offered", status: "issued", contractor_id: null }).eq("id", offerJob.workOrderId);
    payJob = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "closed", status: "complete", contractor_payment_cents: 100_000, start_date: "2026-10-06", end_date: "2026-10-08" }).eq("id", payJob.workOrderId);
    // Signed Friday 9 Oct 2026, 4 pm Melbourne.
    await db!.from("wo_signoff").upsert({ work_order_id: payJob.workOrderId, signed_at: "2026-10-09T05:00:00Z", signed_name: "E2E Customer", signed_kind: "in_person", areas: {} }, { onConflict: "work_order_id" });

    const created = await db!.auth.admin.createUser({ email: employee.email, password: employee.password, email_confirm: true, user_metadata: { name: "E2E Lead Employee" } });
    if (created.error || !created.data.user) throw new Error(created.error?.message);
    employeeUserId = created.data.user.id;
    await db!.from("profiles").update({ role: "contractor", name: "E2E Lead Employee" }).eq("id", employeeUserId);
    const emp = await db!.from("contractors").insert({ profile_id: employeeUserId, tier: "B", active: true, company_name: "", employment_type: "employee" }).select("id").single();
    if (emp.error) throw new Error(emp.error.message);
    employeeId = (emp.data as { id: string }).id;
  });

  test.afterAll(async () => {
    if (!db) return;
    await db.from("contractor_invoices").delete().in("work_order_id", [offerJob?.workOrderId ?? "", payJob?.workOrderId ?? ""].filter(Boolean));
    await db.from("painter_bonuses").delete().in("painter_id", [contractorId, employeeId].filter(Boolean));
    await db.from("painter_status").delete().in("painter_id", [contractorId, employeeId].filter(Boolean));
    for (const f of [offerJob, payJob]) await destroyLoopFixture(db, f);
    if (employeeId) await db.from("contractors").delete().eq("id", employeeId);
    if (employeeUserId) await db.auth.admin.deleteUser(employeeUserId);
    if (savedProfile) await db.from("contractors").update(savedProfile).eq("id", contractorId);
    if (savedRules) await db.from("settings").update({ value: savedRules }).eq("key", "painter_status_rules");
  });

  test("a Red painter gets no offer until the owner clears them; the table refuses too; a Red employee cannot be made lead", async () => {
    await setColour(contractorId, "red");
    const args = { p_work_order_id: offerJob!.workOrderId, p_contractor_id: contractorId, p_start: "2026-12-01", p_end: null, p_note: "" };
    expect(await rpcAs(staff!, "send_offer", args)).toBe("error:red_no_clearance");
    // The last line of defence: a direct insert is refused by the trigger.
    const direct = await db!.from("booking_offers").insert({ work_order_id: offerJob!.workOrderId, contractor_id: contractorId, start_date: "2026-12-01", state: "offered", expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect(direct.error?.message ?? "").toContain("red_no_clearance");
    // A Red employee as lead on a job: refused at the table.
    await setColour(employeeId, "red");
    const lead = await db!.from("wo_assignments").insert({ work_order_id: offerJob!.workOrderId, contractor_id: employeeId, start_date: "2026-12-01", end_date: "2026-12-02", is_lead: true, status: "assigned" });
    expect(lead.error?.message ?? "").toContain("red_no_clearance");
    // Not the owner: a contractor cannot clear anyone.
    expect(await rpcAs(contractor!, "painter_clear_red", { p_painter_id: contractorId, p_reason: "me" })).toBe("error:not_staff");
    expect(await rpcAs(staff!, "painter_clear_red", { p_painter_id: contractorId, p_reason: "x" })).toBe("error:no_reason");
    expect(await rpcAs(staff!, "painter_clear_red", { p_painter_id: contractorId, p_reason: "Spoke on 8 Oct — plan agreed" })).toBe("ok:cleared");
    expect(await rpcAs(staff!, "send_offer", args)).toBe("ok:offered");
    const { data: ev } = await db!.from("contractor_events").select("type").eq("contractor_id", contractorId).eq("type", "red_clearance_given").limit(1);
    expect(ev?.length).toBe(1);
  });

  test("the board: a Red lane says so; the owner's page shows the clearance", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/schedule");
    await expect(page.getByTestId(`lane-status-${contractorId}`)).toHaveAttribute("data-colour", "red");
    await page.goto(`/contractors/${contractorId}`);
    await expect(page.getByTestId("status-colour")).toHaveText("Red");
    await expect(page.getByTestId("red-cleared")).toContainText("plan agreed");
  });

  test("Green at sign-off: due 3 business days later across the weekend; the hold goes back to default terms, never later; release returns it", async ({ page }) => {
    await setColour(contractorId, "green");
    const { data, error } = await db!.rpc("contractor_invoice_draft", { p_work_order_id: payJob!.workOrderId });
    expect(error?.message ?? "").toBe("");
    expect(String(data)).toMatch(/^ok:/);
    ciId = String(data).slice(3);
    let row = await ci(ciId);
    expect(row.terms_kind).toBe("green_fast");
    expect(row.due_on).toBe("2026-10-14"); // Fri 9 Oct + 3 business days = Wed 14 Oct
    expect(await rpcAs(contractor!, "contractor_invoice_hold_fast_terms", { p_id: ciId, p_reason: "nope" })).toBe("error:not_staff");
    expect(await rpcAs(staff!, "contractor_invoice_hold_fast_terms", { p_id: ciId, p_reason: "Customer rang about a mark on the hall wall" })).toBe("ok:held");
    row = await ci(ciId);
    expect(row.terms_kind).toBe("held");
    expect(row.due_on).toBe("2026-10-16"); // the default 7 days — never later than that
    await signIn(page, staff!, /\/(home|estimates)/);
    await pcQueue(page);
    const card = page.locator(`[data-kind="payment_hold"]`).filter({ hasText: "mark on the hall wall" });
    await expect(card).toHaveCount(1);
    expect(await rpcAs(staff!, "contractor_invoice_release_fast_terms", { p_id: ciId })).toBe("ok:released");
    row = await ci(ciId);
    expect(row.terms_kind).toBe("green_fast");
    expect(row.due_on).toBe("2026-10-14");
    await pcQueue(page);
    await expect(page.locator(`[data-kind="payment_hold"]`)).toHaveCount(0);
    // Not Green: the default terms.
    await db!.from("contractor_invoices").delete().eq("id", ciId);
    await setColour(contractorId, "yellow");
    const again = await db!.rpc("contractor_invoice_draft", { p_work_order_id: payJob!.workOrderId });
    const row2 = await ci(String(again.data).slice(3));
    expect(row2.terms_kind).toBe("default");
    expect(row2.due_on).toBe("2026-10-16");
    await db!.from("contractor_invoices").delete().eq("id", row2.id);
  });

  test("bonus: the card, Tell Tom, approve refused while the switch is off, approved when on; the painter claims it and an invoice is raised; the customer reads nothing", async ({ page }) => {
    test.setTimeout(150_000);
    await setColour(contractorId, "green");
    const ins = await db!.from("painter_bonuses").insert({ painter_id: contractorId, trigger_wo_id: payJob!.workOrderId, qualifying_wo_ids: [payJob!.workOrderId], suggested_cents: 50_000 }).select("id").single();
    expect(ins.error?.message ?? "").toBe("");
    bonusId = (ins.data as { id: string }).id;

    await signIn(page, staff!, /\/(home|estimates)/);
    await pcQueue(page);
    const card = page.locator(`[data-kind="bonus_due"]`).filter({ hasText: "Bonus due" });
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: "Tell Tom" }).click();
    await expect(card.getByText("With Tom")).toBeVisible();
    expect((await bonus(bonusId)).status).toBe("with_owner");

    await page.goto(`/contractors/${contractorId}`);
    const row = page.getByTestId(`bonus-${bonusId}`);
    await expect(row).toHaveAttribute("data-status", "with_owner");
    await expect(page.getByTestId(`bonus-approve-${bonusId}`)).toBeDisabled();
    await expect(page.getByTestId("bonus-approvals-off")).toBeVisible();
    expect(await rpcAs(staff!, "bonus_decide", { p_id: bonusId, p_approve: true, p_amount_cents: 50_000, p_note: "" })).toBe("error:approvals_off");
    expect(await rpcAs(contractor!, "bonus_decide", { p_id: bonusId, p_approve: true, p_amount_cents: 50_000, p_note: "" })).toBe("error:not_staff");

    await db!.from("settings").update({ value: { ...savedRules, bonusApprovalsEnabled: true } }).eq("key", "painter_status_rules");
    await page.reload();
    await page.getByTestId(`bonus-amount-${bonusId}`).fill("500");
    await page.getByTestId(`bonus-approve-${bonusId}`).click();
    await expect(page.getByTestId("status-msg")).toContainText(/Approved/);
    const b = await bonus(bonusId);
    expect(b.status).toBe("approved");
    expect(b.amount_cents).toBe(50_000);
    expect(await rpcAs(staff!, "bonus_decide", { p_id: bonusId, p_approve: false })).toBe("error:already_approved");

    // Reads by role: the painter sees their approved bonus only; the customer sees none.
    const mine = await readAs(contractor!, `painter_bonuses?select=id,status,amount_cents&painter_id=eq.${contractorId}`);
    expect(mine.map((r) => (r as { status: string }).status)).toEqual(["approved"]);
    expect(await readAs(customer!, "painter_bonuses?select=id")).toEqual([]);

    // The painter claims it.
    await page.context().clearCookies();
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/money");
    await expect(page.getByTestId(`bonus-claim-amount-${bonusId}`)).toHaveText("$500.00");
    await page.getByTestId(`bonus-claim-button-${bonusId}`).click();
    await expect(page.getByTestId("bonus-claim-msg")).toContainText(/Claimed/);
    const after = await bonus(bonusId);
    expect(after.payment_ref).not.toBe("");
    const inv = await ci(after.payment_ref);
    expect(inv.auto_draft_source).toBe("bonus");
    expect(inv.status).toBe("submitted");
    expect(inv.total_inc_cents).toBe(50_000);
    expect(inv.lines[0].cents).toBe(50_000);
    await expect(page.getByTestId("bonus-claim-card")).toHaveCount(0);
    await expect(page.getByText(/· bonus/)).toBeVisible();
    // Paid through the normal channel marks the bonus paid.
    expect(await rpcAs(staff!, "contractor_invoice_approve", { p_id: inv.id })).toMatch(/^ok:/);
    expect(await rpcAs(staff!, "contractor_invoice_mark_paid", { p_id: inv.id, p_reference: "E2E", p_paid_on: "2026-10-09" })).toBe("ok:paid");
    expect((await bonus(bonusId)).status).toBe("paid");
  });

  test("an employed lead's approved bonus goes on the payroll CSV", async ({ page }) => {
    await db!.from("settings").update({ value: { ...savedRules, bonusApprovalsEnabled: true } }).eq("key", "painter_status_rules");
    const ins = await db!.from("painter_bonuses").insert({ painter_id: employeeId, trigger_wo_id: payJob!.workOrderId, qualifying_wo_ids: [payJob!.workOrderId], suggested_cents: 50_000 }).select("id").single();
    expect(ins.error?.message ?? "").toBe("");
    const id = (ins.data as { id: string }).id;
    expect(await rpcAs(staff!, "bonus_decide", { p_id: id, p_approve: true, p_amount_cents: 60_000, p_note: "" })).toBe("ok:approved");
    expect(await rpcAs(employee, "bonus_claim", { p_id: id })).toBe("error:employee_payroll");
    await signIn(page, staff!, /\/(home|estimates)/);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const res = await page.request.get(`/pc/timesheets/export?from=${today}&to=${today}`);
    expect(res.ok()).toBe(true);
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain("bonus_cents");
    expect(csv).toMatch(/E2E Lead Employee,.*,bonus,.*,60000/);
  });
});
