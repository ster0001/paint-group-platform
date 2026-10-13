import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, drawSignature, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Revise scope reaches the painter — Tom, 12 Oct 2026 (20270253), corrected
 * 13 Oct (20270254): "if a contractor's hourly rate changes it should skip the
 * customer, if it's the hours themselves it goes to the customer."
 *
 *  1. 73 Kerferd Rd: a painter is on the job and the contractor's HOURS change
 *     (the customer's price does not). Save warns it goes to the customer
 *     first; Save does NOT send it to the painter; Save & draft puts it in the
 *     customer's offer; the customer signs; THEN it is the painter's to accept.
 *  2. Nobody has the job yet: the customer signs the change, and the job
 *     sheet BECOMES the new scope. The painter's copy lists no variations.
 *     The office is told the customer approved (staff alert claimed).
 *  3. The contractor's hourly RATE changes: Save warns, the customer is never
 *     asked. Nobody on the job → their price just follows. A painter on the
 *     job → "Change to your rate" for them to Accept (pay moves) or Decline
 *     (pay stays; the office is told).
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");

const wall = (id: number, hours: number) => ({
  id, code: "Walls", coats: 2, count: 0, prepHr: 0, internalLabel: "Walls", clientLabel: "Walls",
  // Imported shape: the customer's price is pinned; the painting hours are typed.
  priceOverride: 500, paintingHrOverride: hours,
});
const room = (id: number, name: string, sid: number, hours: number) =>
  ({ kind: "area", id, name, type: "Interior", areaType: "room", L: 4, W: 4, H: 2.4, surfaces: [wall(sid, hours)] });
const MODSEL = { "Level of Finish": "FIN-3" };

async function openScope(estimateId: string, accepted: Record<string, unknown>, working: Record<string, unknown>) {
  const { data: card, error: cardErr } = await db!.from("rate_cards").select("id, version").eq("is_active", true).single();
  if (cardErr || !card) throw new Error(`no active rate card — run scripts/c1/seed.mjs (${cardErr?.message ?? "none"})`);
  const { error: bsErr } = await db!.from("estimates")
    .update({ builder_state: accepted, rate_card_id: card.id, rate_card_version: card.version }).eq("id", estimateId);
  if (bsErr) throw new Error(`builder_state: ${bsErr.message}`);
  const opened = await rpcAs(staff!, "wo_open_working_scope", { p_estimate_id: estimateId });
  expect(JSON.stringify(opened)).not.toContain("error");
  const { error } = await db!.from("wo_working_scopes").update({ working_state: working }).eq("estimate_id", estimateId);
  if (error) throw new Error(`working scope: ${error.message}`);
}

test.describe.configure({ mode: "serial" });

test.describe("Revise scope reaches the painter", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));

  let onJob: LoopFixture | null = null;
  let unsent: LoopFixture | null = null;
  let hoursVariationId = "";
  let offerToken = "";

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    if (!contractorId) throw new Error(`no contractors row for ${contractor!.email}`);
    onJob = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls"] }]);
    unsent = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls"] }]);
    // Nobody on the second job: not offered, not assigned.
    const { error } = await db!.from("work_orders").update({ contractor_id: null }).eq("id", unsent.workOrderId);
    if (error) throw new Error(`unsent job: ${error.message}`);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, onJob);
    await destroyLoopFixture(db!, unsent);
  });

  test("1. hours change with a painter on the job: Save warns and does NOT reach the painter; it is drafted for the customer", async ({ page }) => {
    const accepted = { blocks: [room(1, "Lounge", 11, 5)], modSel: MODSEL };
    await openScope(onJob!.estimateId, accepted, accepted);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${onJob!.estimateId}&mode=revision`);
    await expect(page.getByTestId("revision-badge")).toBeVisible();
    await page.getByTestId("preparation-hours").fill("4");
    await page.getByTestId("preparation-hours").blur();

    // The warning names the hours and says where they go. Cancel saves nothing.
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); void d.dismiss(); });
    await page.getByTestId("builder-save").click();
    await expect.poll(() => asked).toContain("Contractor hours have changed");
    expect(asked).toContain("customer to sign first");
    const { data: before } = await db!.from("wo_working_scopes").select("working_state").eq("estimate_id", onJob!.estimateId).single();
    expect((before as { working_state: { preparationHours?: number | null } }).working_state.preparationHours ?? null).toBeNull();

    // OK saves — and nothing goes to the painter on a save.
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("builder-save").click();
    await expect(page.getByText(/Saved ✓ \(working scope\)/)).toBeVisible({ timeout: 20_000 });
    const { data: none } = await db!.from("wo_variations").select("id").eq("work_order_id", onJob!.workOrderId).not("revision_block_ref", "is", null);
    expect(none, "a save never sends hours to the painter").toEqual([]);

    // Save & draft: the hours change is in the CUSTOMER's offer.
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("draft-variations").click();
    await expect(page.getByTestId("drafted-list")).toBeVisible({ timeout: 20_000 });
    const { data, error } = await db!.from("wo_variations")
      .select("id, status, est_hours, released_at, customer_token, hours_only")
      .eq("work_order_id", onJob!.workOrderId).not("revision_block_ref", "is", null);
    if (error) throw new Error(error.message);
    const rows = data as { id: string; status: string; est_hours: string; released_at: string | null; customer_token: string | null; hours_only: boolean }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("priced");
    expect(rows[0].hours_only).toBe(false);
    expect(rows[0].released_at, "not with the painter yet").toBeNull();
    expect(rows[0].customer_token).not.toBeNull();
    hoursVariationId = rows[0].id;
    offerToken = rows[0].customer_token!;
  });

  test("1b. the customer signs, THEN the painter on the job accepts it", async ({ page }) => {
    await page.goto(`/v/${offerToken}`);
    await page.getByTestId("approve-variation").click();
    await page.getByTestId("sign-name").fill("Kerferd Customer");
    await drawSignature(page);
    await page.getByTestId("confirm-sign").click();
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved");
    const { data: v } = await db!.from("wo_variations").select("status, released_at").eq("id", hoursVariationId).single();
    expect((v as { status: string }).status).toBe("customer_approved");
    expect((v as { released_at: string | null }).released_at, "released to the painter at the signature").not.toBeNull();

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${onJob!.workOrderId}`);
    await expect(page.getByTestId(`approved-by-client-${hoursVariationId}`)).toContainText("Variation approved by the client");
    await page.getByTestId(`accept-${hoursVariationId}`).click();
    await expect.poll(async () => {
      const { data } = await db!.from("wo_variations").select("status").eq("id", hoursVariationId).single();
      return (data as { status: string } | null)?.status;
    }, { timeout: 15_000 }).toBe("contractor_accepted");
    offerToken = "";
  });

  test("2. nobody on the job: the change is drafted for the customer", async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
    const accepted = { blocks: [room(1, "Lounge", 11, 5)], modSel: MODSEL };
    const garage = { ...room(3, "Garage", 31, 6), surfaces: [{ ...wall(31, 6), priceOverride: 800 }] };
    await openScope(unsent!.estimateId, accepted, { ...accepted, blocks: [room(1, "Lounge", 11, 5), garage] });

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${unsent!.estimateId}&mode=revision`);
    await page.getByTestId("draft-variations").click();
    await expect(page.getByTestId("drafted-list")).toBeVisible({ timeout: 20_000 });
    const { data } = await db!.from("wo_variations").select("customer_token, priced_inputs").eq("work_order_id", unsent!.workOrderId).eq("status", "priced");
    const rows = data as { customer_token: string; priced_inputs: { sheet?: { areas?: { title: string }[] } } }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].priced_inputs.sheet?.areas?.map((a) => a.title), "the job sheet rides the draft").toContain("Garage");
    offerToken = rows[0].customer_token;
  });

  test("2b. the anonymous customer signs → the job sheet IS the new scope, no variation list; the office is told", async ({ page }) => {
    await page.goto(`/v/${offerToken}`);
    await page.getByTestId("approve-variation").click();
    await page.getByTestId("sign-name").fill("Unsent Customer");
    await drawSignature(page);
    await page.getByTestId("confirm-sign").click();
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved");

    const { data: v } = await db!.from("wo_variations").select("id, status, in_sheet_at").eq("work_order_id", unsent!.workOrderId).not("revision_block_ref", "is", null);
    const rows = v as { id: string; status: string; in_sheet_at: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("contractor_accepted");
    expect(rows[0].in_sheet_at, "folded into the sheet").not.toBeNull();

    const { data: wo } = await db!.from("work_orders").select("share_token, wo_snapshot, contractor_payment_cents").eq("id", unsent!.workOrderId).single();
    const w = wo as { share_token: string; contractor_payment_cents: number; wo_snapshot: { areas: { title: string }[]; contractorPaymentCents: number } };
    expect(w.wo_snapshot.areas.map((a) => a.title)).toContain("Garage");
    // The sheet's pay figure stays the BASE pay; the folded row carries the
    // Garage's hours on top (send_offer adds them), so nothing counts twice.
    expect(w.wo_snapshot.contractorPaymentCents, "the base pay figure is kept — the row carries the change").toBe(w.contractor_payment_cents);

    // The painter's copy: the Garage is on the sheet, and nothing reads as a variation.
    await page.goto(`/w/${w.share_token}`);
    await expect(page.getByText("Garage").first()).toBeVisible();
    await expect(page.getByTestId("scope-changes")).toHaveCount(0);

    // The office alert was claimed once for the signing (sent to whoever ticks
    // "Change approved" under Staff logins).
    await expect.poll(async () => {
      const { data: claim } = await db!.from("staff_notifications").select("id").eq("event_key", "office_variation_approved").eq("entity_id", rows[0].id);
      return (claim ?? []).length;
    }, { timeout: 15_000 }).toBe(1);
  });
  test("3. rate change, nobody on the job: Save warns, the customer is not asked, the contractor's price follows", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${unsent!.estimateId}&mode=revision`);
    await page.getByRole("button", { name: /Calculations/ }).click();
    const rate = page.getByTestId("contractor-rate");
    await rate.scrollIntoViewIfNeeded();
    await rate.fill("75");
    await rate.blur();
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); void d.accept(); });
    await page.getByTestId("builder-save").click();
    await expect(page.getByText(/Saved ✓ \(working scope\) · contractor's price updated/)).toBeVisible({ timeout: 20_000 });
    expect(asked).toContain("hourly rate has changed");
    expect(asked).toContain("does not go to the customer");

    const { data: wo } = await db!.from("work_orders").select("contractor_rate_cents, pay_change_rate_cents").eq("id", unsent!.workOrderId).single();
    expect(wo).toMatchObject({ contractor_rate_cents: 7500, pay_change_rate_cents: null });
    const { data: priced } = await db!.from("wo_variations").select("id").eq("work_order_id", unsent!.workOrderId).eq("status", "priced");
    expect(priced, "no customer offer for a rate").toEqual([]);
  });

  test("3b. rate change, painter on the job: it goes to THEM to accept — never to the customer", async ({ page }) => {
    const { data: w0 } = await db!.from("work_orders").select("contractor_payment_cents").eq("id", onJob!.workOrderId).single();
    const basePay = (w0 as { contractor_payment_cents: number | null }).contractor_payment_cents ?? 0;

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${onJob!.estimateId}&mode=revision`);
    await page.getByRole("button", { name: /Calculations/ }).click();
    const rate = page.getByTestId("contractor-rate");
    await rate.scrollIntoViewIfNeeded();
    await rate.fill("80");
    await rate.blur();
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("builder-save").click();
    await expect(page.getByText(/new rate sent to the contractor to accept/)).toBeVisible({ timeout: 20_000 });

    const { data } = await db!.from("work_orders")
      .select("contractor_payment_cents, pay_change_rate_cents, pay_change_from_rate_cents, pay_change_base_hours, pay_change_from_cents, pay_change_to_cents")
      .eq("id", onJob!.workOrderId).single();
    const pc = data as { contractor_payment_cents: number | null; pay_change_rate_cents: number; pay_change_from_rate_cents: number; pay_change_base_hours: string; pay_change_from_cents: number; pay_change_to_cents: number };
    expect(pc.pay_change_rate_cents).toBe(8000);
    expect(pc.contractor_payment_cents ?? 0, "nothing moves until they accept").toBe(basePay);
    // The accepted 4 h change from test 1 rides along with the base hours.
    const diff = pc.pay_change_rate_cents - pc.pay_change_from_rate_cents;
    expect(pc.pay_change_to_cents - pc.pay_change_from_cents).toBe(Math.round((Number(pc.pay_change_base_hours) + 4) * diff));
    const { data: offers } = await db!.from("wo_variations").select("id").eq("work_order_id", onJob!.workOrderId).eq("status", "priced");
    expect(offers, "no customer offer for a rate").toEqual([]);

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${onJob!.workOrderId}`);
    await expect(page.getByTestId("pay-change")).toContainText("Change to your rate");
    await expect(page.getByTestId("pay-change-rate")).toContainText("$80/h");
    await page.getByTestId("pay-change-accept").click();
    await expect(page.getByTestId("pay-change-done")).toContainText("Accepted");

    const { data: after } = await db!.from("work_orders").select("contractor_payment_cents, contractor_rate_cents, pay_change_rate_cents").eq("id", onJob!.workOrderId).single();
    const a = after as { contractor_payment_cents: number; contractor_rate_cents: number; pay_change_rate_cents: number | null };
    expect(a.pay_change_rate_cents).toBeNull();
    expect(a.contractor_rate_cents).toBe(8000);
    expect(a.contractor_payment_cents).toBe(basePay + Math.round(Number(pc.pay_change_base_hours) * diff));
    const { data: v } = await db!.from("wo_variations").select("contractor_delta_cents, est_hours").eq("id", hoursVariationId).single();
    const vv = v as { contractor_delta_cents: number; est_hours: string };
    expect(vv.contractor_delta_cents, "the agreed change is re-rated").toBe(Math.round(Number(vv.est_hours) * 8000));
  });

  test("3c. the painter declines a new rate with a note: pay stays, the office is told", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${onJob!.estimateId}&mode=revision`);
    await page.getByRole("button", { name: /Calculations/ }).click();
    const rate = page.getByTestId("contractor-rate");
    await rate.scrollIntoViewIfNeeded();
    await rate.fill("70");
    await rate.blur();
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("builder-save").click();
    await expect(page.getByText(/new rate sent to the contractor to accept/)).toBeVisible({ timeout: 20_000 });
    const { data: w0 } = await db!.from("work_orders").select("contractor_payment_cents").eq("id", onJob!.workOrderId).single();
    const pay = (w0 as { contractor_payment_cents: number }).contractor_payment_cents;

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${onJob!.workOrderId}`);
    await page.getByTestId("pay-change-decline").click();
    await page.getByTestId("pay-change-note").fill("I can't drop to $70 on this one — $80 as agreed please.");
    await page.getByTestId("pay-change-decline-send").click();
    await expect(page.getByTestId("pay-change-done")).toContainText("declined");

    const { data: after } = await db!.from("work_orders").select("contractor_payment_cents, contractor_rate_cents, pay_change_rate_cents").eq("id", onJob!.workOrderId).single();
    expect(after).toMatchObject({ contractor_payment_cents: pay, contractor_rate_cents: 8000, pay_change_rate_cents: null });
    const { data: ev } = await db!.from("wo_events").select("id").eq("work_order_id", onJob!.workOrderId).eq("type", "pay_change_declined").order("created_at", { ascending: false }).limit(1);
    const evId = (ev as { id: string }[])[0].id;
    await expect.poll(async () => {
      const { data: claim } = await db!.from("staff_notifications").select("id").eq("event_key", "office_variation_declined").eq("entity_id", `pay:${evId}`);
      return (claim ?? []).length;
    }, { timeout: 15_000 }).toBe(1);
  });
});
