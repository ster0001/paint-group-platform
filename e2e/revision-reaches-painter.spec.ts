import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, drawSignature, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 12 Oct 2026 — Revise scope reaches the painter (20270253).
 *
 *  1. 73 Kerferd Rd: the contractor's hours change in the working scope but
 *     the customer's price does not (an imported, price-overridden job). On
 *     SAVE it goes straight to the painter on the job to approve — no $0
 *     signing link for the customer — and their card says "Change to your
 *     hours". Before the save, the builder says what the hours and the
 *     contractor's price are moving to, and Cancel saves nothing.
 *  2. Nobody has the job yet: the customer signs the change, and the job
 *     sheet BECOMES the new scope. The painter's copy lists no variations.
 *  3. The office is told the customer approved (staff alert claimed).
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

  test("1. hours-only change on SAVE goes to the painter on the job — not to the customer", async ({ page }) => {
    const accepted = { blocks: [room(1, "Lounge", 11, 5)], modSel: MODSEL };
    await openScope(onJob!.estimateId, accepted, { ...accepted, blocks: [room(1, "Lounge", 11, 9)] });

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${onJob!.estimateId}&mode=revision`);
    await expect(page.getByTestId("revision-badge")).toBeVisible();
    await page.getByTestId("builder-save").click();
    await expect(page.getByText(/new hours sent to the painter to approve/)).toBeVisible({ timeout: 20_000 });

    const { data, error } = await db!.from("wo_variations")
      .select("id, status, price_cents, est_hours, credit, released_at, customer_token, hours_only, contractor_delta_cents, contractor_rate_cents")
      .eq("work_order_id", onJob!.workOrderId).not("revision_block_ref", "is", null);
    if (error) throw new Error(error.message);
    const rows = data as { id: string; status: string; price_cents: number; est_hours: string; credit: boolean; released_at: string | null; customer_token: string | null; hours_only: boolean; contractor_delta_cents: number; contractor_rate_cents: number }[];
    expect(rows).toHaveLength(1);
    const v = rows[0];
    hoursVariationId = v.id;
    expect(v.price_cents, "the customer's price did not move").toBe(0);
    expect(Number(v.est_hours)).toBeGreaterThan(0);
    expect(v.credit).toBe(false);
    expect(v.status, "approved without a customer signature").toBe("customer_approved");
    expect(v.hours_only).toBe(true);
    expect(v.customer_token, "never in a customer's offer").toBeNull();
    expect(v.released_at, "with the painter").not.toBeNull();
    expect(v.contractor_delta_cents).toBe(Math.round(Number(v.est_hours) * v.contractor_rate_cents));
  });

  test("1b. the painter sees 'Change to your hours' and accepts it", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${onJob!.workOrderId}`);
    await expect(page.getByTestId(`approved-by-client-${hoursVariationId}`)).toContainText("Change to your hours");
    await page.getByTestId(`accept-${hoursVariationId}`).click();
    await expect.poll(async () => {
      const { data } = await db!.from("wo_variations").select("status").eq("id", hoursVariationId).single();
      return (data as { status: string } | null)?.status;
    }, { timeout: 15_000 }).toBe("contractor_accepted");
  });

  test("1c. the builder asks before a save moves the contractor's hours; Cancel saves nothing", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${onJob!.estimateId}&mode=revision`);
    await page.getByTestId("preparation-hours").fill("3");
    await page.getByTestId("preparation-hours").blur();

    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); void d.dismiss(); });
    await page.getByTestId("builder-save").click();
    await expect.poll(() => asked).toContain("Contractor hours have changed");
    expect(asked).toContain("Saving updates the contractor's price");
    const { data } = await db!.from("wo_working_scopes").select("working_state").eq("estimate_id", onJob!.estimateId).single();
    expect((data as { working_state: { preparationHours?: number | null } }).working_state.preparationHours ?? null).toBeNull();

    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("builder-save").click();
    await expect(page.getByText(/Saved ✓ \(working scope\)/)).toBeVisible({ timeout: 20_000 });
    const { data: after } = await db!.from("wo_working_scopes").select("working_state").eq("estimate_id", onJob!.estimateId).single();
    expect((after as { working_state: { preparationHours?: number } }).working_state.preparationHours).toBe(3);
  });

  test("2. nobody on the job: the change is drafted for the customer", async ({ page }) => {
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
});
