import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  serviceClient, rpcAs, type LoopFixture,
} from "./fixtures/woLoop";
import { credentials, missingCreds, signIn, TINY_SIGNATURE_PNG } from "./helpers";

/**
 * Addendum A3, AS CONTRACTOR (rulings 2–3):
 *
 *   a signed clean removal → the tick-row is STRUCK (visible, not deleted),
 *   the painter ACKNOWLEDGES (no veto) and the pay delta is the engine's;
 *   an addition still travels release → ACCEPT with engine hours;
 *   a removal that hits started work routes to the PC, who sets the deduction
 *   by hand — and the contractor sees the figure, told not asked.
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");

let fixture: LoopFixture | null = null;
let cleanCreditId = "";
let additionId = "";
let startedCreditId = "";

const HOURS_RATE = 6_000; // the settings default the DB stamps

test.describe.configure({ mode: "serial" });

test.describe("the contractor loop — acknowledge, accept, started-work guard", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!customer, missingCreds("CUSTOMER"));

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    if (!contractorId) throw new Error(`no contractors row for ${contractor!.email}`);
    fixture = await createLoopFixture(db!, contractorId, [
      { heading: "Left", labels: ["Walls — weatherboard", "Windows × 2"] },
      { heading: "Pergola", labels: ["Frame & posts"] },
    ]);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, fixture); });

  async function draft(blockRef: string, opts: {
    credit: boolean; surfaceKeys: string[]; priceCents: number; hours: number; comment: string;
  }) {
    const result = await rpcAs(staff!, "wo_draft_revision_variation", {
      p_estimate_id: fixture!.estimateId,
      p_block_ref: blockRef,
      p_category: opts.credit ? "scope_removed" : "extra_scope",
      p_comment: opts.comment,
      p_credit: opts.credit,
      p_surface_keys: opts.surfaceKeys,
      p_price_cents: opts.priceCents,
      p_inputs: { source: "revision_diff", test: true },
      p_priced_lines: [{ label: opts.comment, cents: opts.credit ? -opts.priceCents : opts.priceCents }],
      p_hours: opts.hours,
    });
    expect(result).toMatch(/^ok:/);
    return result.slice(3); // the customer token
  }

  test("a signed clean removal strikes the row and asks for acknowledgement", async ({ page }) => {
    const token = await draft("block:pergola", {
      credit: true, surfaceKeys: ["a1:0"], priceCents: 48_000, hours: 2,
      comment: "Pergola — removed from scope",
    });
    const signedResult = await rpcAs(customer!, "wo_customer_sign_variation", {
      p_token: token, p_name: "A3 Customer", p_signature: TINY_SIGNATURE_PNG,
    });
    expect(signedResult).toBe("ok:approved");

    const { data: v } = await db!.from("wo_variations")
      .select("id, status, needs_manual_deduction, contractor_delta_cents")
      .eq("work_order_id", fixture!.workOrderId).eq("credit", true).single();
    const row = v as { id: string; status: string; needs_manual_deduction: boolean; contractor_delta_cents: number };
    cleanCreditId = row.id;
    expect(row.status).toBe("customer_approved");
    expect(row.needs_manual_deduction).toBe(false);
    expect(row.contractor_delta_cents).toBe(2 * HOURS_RATE);

    // The strike landed on the untouched surface.
    const { data: s } = await db!.from("wo_surfaces")
      .select("removed_from_scope").eq("work_order_id", fixture!.workOrderId)
      .eq("surface_key", "a1:0").single();
    expect((s as { removed_from_scope: boolean }).removed_from_scope).toBe(true);

    // The painter sees it struck, and the progress bar stops counting it.
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    const struckRow = page.locator(".tickrow.removed");
    await expect(struckRow).toHaveCount(1);
    await expect(struckRow).toContainText("Removed from scope");
    await expect(page.getByTestId("tick-progress")).toHaveText("0 / 2");

    // Acknowledge — no veto, and the figure is the engine's.
    const ack = page.getByTestId(`acknowledge-${cleanCreditId}`);
    await expect(ack).toContainText("− $120.00");
    await ack.click();
    await expect(page.getByTestId(`delta-${cleanCreditId}`)).toContainText("comes off your payment");

    const { data: after } = await db!.from("wo_variations")
      .select("status, contractor_acknowledged_at").eq("id", cleanCreditId).single();
    const a = after as { status: string; contractor_acknowledged_at: string | null };
    expect(a.status).toBe("contractor_accepted");
    expect(a.contractor_acknowledged_at).not.toBeNull();
  });

  test("an addition still travels release → accept, with engine hours", async ({ page }) => {
    const token = await draft("block:porch", {
      credit: false, surfaceKeys: [], priceCents: 84_000, hours: 3,
      comment: "Front porch — added",
    });
    expect((await rpcAs(customer!, "wo_customer_sign_variation", {
      p_token: token, p_name: "A3 Customer", p_signature: TINY_SIGNATURE_PNG,
    }))).toBe("ok:approved");

    const { data: v } = await db!.from("wo_variations")
      .select("id").eq("work_order_id", fixture!.workOrderId)
      .eq("revision_block_ref", "block:porch").single();
    additionId = (v as { id: string }).id;

    // Sign-first (flag 2): release is only possible after the signature —
    // proven by the accept refusals in wo-variations.spec; here the happy
    // path. Since 3 Sep 2026 the sign itself releases when the setting says
    // auto (variation-auto-release.spec.ts), so the office's release is
    // either the act or a no-op — never a refusal.
    expect(["ok:released", "ok:already"]).toContain(await rpcAs(staff!, "wo_release_variation", { p_variation_id: additionId }));

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    const accept = page.getByTestId(`accept-${additionId}`);
    await expect(accept).toContainText("Accept $180.00 — 3 hrs");
    await accept.click();
    await expect(page.getByTestId(`delta-${additionId}`)).toContainText("$180.00 added to your payment");
  });

  test("a removal on STARTED work routes to the PC, never a computed deduction", async ({ page }) => {
    // The painter has already prepped a Left surface.
    await db!.from("wo_surfaces").update({ state: "prepped" })
      .eq("work_order_id", fixture!.workOrderId).eq("surface_key", "a0:1");

    const token = await draft("block:left-windows", {
      credit: true, surfaceKeys: ["a0:1"], priceCents: 30_000, hours: 1,
      comment: "Left windows — removed from scope",
    });
    expect((await rpcAs(customer!, "wo_customer_sign_variation", {
      p_token: token, p_name: "A3 Customer", p_signature: TINY_SIGNATURE_PNG,
    }))).toBe("ok:approved");

    const { data: v } = await db!.from("wo_variations")
      .select("id, needs_manual_deduction, deduction_cents")
      .eq("work_order_id", fixture!.workOrderId)
      .eq("revision_block_ref", "block:left-windows").single();
    const row = v as { id: string; needs_manual_deduction: boolean; deduction_cents: number | null };
    startedCreditId = row.id;
    expect(row.needs_manual_deduction).toBe(true);
    expect(row.deduction_cents).toBeNull();

    // Started work is never struck — it happened.
    const { data: s } = await db!.from("wo_surfaces")
      .select("removed_from_scope, state").eq("work_order_id", fixture!.workOrderId)
      .eq("surface_key", "a0:1").single();
    expect(s).toEqual({ removed_from_scope: false, state: "prepped" });

    // The contractor cannot acknowledge past an unset deduction.
    expect(await rpcAs(contractor!, "wo_contractor_acknowledge_variation", {
      p_variation_id: startedCreditId,
    })).toBe("error:awaiting_pc_deduction");

    // The painter is told it's with the office.
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await expect(page.getByTestId(`deduction-pending-${startedCreditId}`))
      .toContainText("working out the pay adjustment");
  });

  test("the PC sets the deduction by hand and the contractor sees the figure", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);

    // The dashboard flags it…
    await page.goto("/pc");
    await expect(page.getByTestId(`card-variation-deduction:${startedCreditId}`)).toBeVisible();

    // …and the job page takes the figure.
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);
    await expect(page.getByTestId(`set-deduction-${startedCreditId}`)).toBeVisible();
    await page.getByTestId(`deduction-amount-${startedCreditId}`).fill("150");
    await page.getByTestId(`deduction-note-${startedCreditId}`).fill("Half the windows were already prepped");
    await page.getByTestId(`set-deduction-btn-${startedCreditId}`).click();
    await expect(page.getByTestId(`deduction-set-${startedCreditId}`)).toBeVisible({ timeout: 15_000 });

    const { data: v } = await db!.from("wo_variations")
      .select("status, deduction_cents, deduction_note").eq("id", startedCreditId).single();
    expect(v).toEqual({
      status: "contractor_accepted",
      deduction_cents: 15_000,
      deduction_note: "Half the windows were already prepped",
    });
  });

  test("the contractor's job page shows the office-set figure", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await expect(page.getByTestId(`delta-${startedCreditId}`))
      .toContainText("$150.00 comes off your payment");
    await expect(page.getByTestId(`delta-${startedCreditId}`)).toContainText("set by the office");
  });
});
