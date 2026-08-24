import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcAs, rpcAsJson, serviceClient, contractorIdForEmail } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn, drawSignature } from "./helpers";
import { priceEstimateTotals, type PricingContext, type BlockInput } from "../lib/pricing/estimate";
import type { RateItem, Product } from "../lib/pricing/types";
import { gstFromIncCents } from "../lib/invoicing/gst";
import { variationLineExCents } from "../lib/invoicing/variation";
import { contractorAdjustedCents, type PayVariation } from "../lib/workorder/contractorPay";

/**
 * Addendum A4 — the end-to-end proof, in real roles and real UIs:
 *
 *   accept → revision (one ADD, one CREDIT) → both drafted from the builder
 *   → both SIGNED on /v with the drawn pad → contractor accepts + acknowledges
 *   → the ledger's adjusted contract equals the ENGINE's working-scope total
 *   to the cent → the final invoice drafts from it, carries each signed
 *   variation as its own GST-backed-out line, and reconciles (drift = 0)
 *   → the contractor deltas are hours × the stamped rate → and the accepted
 *   estimate row never changed by a byte.
 *
 * No figure in this file is typed: every expected number comes from
 * lib/pricing, lib/invoicing or lib/workorder — the same modules production
 * uses.
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const customer = credentials("CUSTOMER");
const contractor = credentials("CONTRACTOR");

const wall = (id: number) => ({
  id, code: "WALL", coats: 2, count: 0, prepHr: 1,
  internalLabel: "Walls", clientLabel: "Walls",
});
const AREA = (id: number, name: string, L: number, W: number, sid: number) => ({
  kind: "area", id, name, type: "Interior", areaType: "room", L, W, H: 2.4,
  surfaces: [wall(sid)],
});
const lounge = AREA(1, "Lounge", 5, 4, 11);
const pergola = AREA(2, "Pergola", 3, 3, 21);
const garage = AREA(3, "Garage", 6, 6, 31);

const MODSEL = { "Level of Finish": "FIN-3" };
const acceptedState = { blocks: [lounge, pergola], modSel: MODSEL };
const workingState = { blocks: [lounge, garage], modSel: MODSEL };

let estimateId = "";
let workOrderId = "";
let ctx: PricingContext | null = null;
let frozenRow: Record<string, unknown> | null = null;
let creditId = "";
let additionId = "";

const totalsOf = (blocks: unknown[]) =>
  priceEstimateTotals(blocks as BlockInput[], ctx!, { modSel: MODSEL, materials: {} });

test.describe.configure({ mode: "serial" });

test.describe("A4 — ledger and final invoice reconcile to the cent", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!customer, missingCreds("CUSTOMER"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));

  test.beforeAll(async () => {
    const sb = db!;
    const { data: card } = await sb.from("rate_cards").select("id, version").eq("is_active", true).single();
    if (!card) throw new Error("no active rate card — run scripts/c1/seed.mjs");
    const [ri, pr, mo, se] = await Promise.all([
      sb.from("rate_items").select("*").eq("rate_card_id", card.id),
      sb.from("products").select("*"),
      sb.from("modifiers").select("*").eq("active", true),
      sb.from("settings").select("key, value"),
    ]);
    ctx = {
      rateItems: (ri.data ?? []) as unknown as RateItem[],
      products: (pr.data ?? []) as unknown as Product[],
      modifiers: (mo.data ?? []) as PricingContext["modifiers"],
      settings: (se.data ?? []) as PricingContext["settings"],
    };

    const accepted = totalsOf(acceptedState.blocks);
    const token = `a4test${Math.abs(Date.now() % 1e10)}${process.pid}`;
    const { data: est, error } = await sb.from("estimates").insert({
      title: "A4 reconcile e2e",
      status: "sent",
      level_of_finish: 3,
      share_token: token,
      rate_card_id: card.id,
      rate_card_version: card.version,
      total_cents: accepted.totalCents,
      builder_state: acceptedState,
      sent_snapshot: {
        totals: { totalCents: accepted.totalCents },
        depositPct: 10,
        jobAddress: `4 Reconcile Ct ${process.pid}`,
        jobTitle: "Interior repaint",
        gstRatePct: 10,
        baseSubtotalCents: accepted.netSubtotalCents,
        areas: [{
          id: "a1", title: "Lounge & Pergola",
          descriptionHtml: "<p>Walls, 2 coats</p>",
          priceCents: accepted.netSubtotalCents, surfaces: [], photos: [],
        }],
        lineItems: [], options: [],
      },
    }).select("id").single();
    if (error) throw new Error(`fixture estimate: ${error.message}`);
    estimateId = (est as { id: string }).id;

    const acc = await sb.rpc("accept_estimate", {
      p_token: token, p_name: "A4 Customer", p_options: [],
      p_total_cents: 0, p_deposit_cents: 0,
    });
    if (acc.data !== "accepted") throw new Error(`accept: ${acc.data}`);

    const contractorId = await contractorIdForEmail(sb, contractor!.email);
    const { data: wo } = await sb.from("work_orders").select("id").eq("estimate_id", estimateId).single();
    workOrderId = (wo as { id: string }).id;
    await sb.from("work_orders").update({
      contractor_id: contractorId, stage: "in_progress", status: "in_progress",
      issued_at: new Date().toISOString(),
    }).eq("id", workOrderId);

    const seeded = await rpcAs(staff!, "wo_seed_surfaces", {
      p_work_order_id: workOrderId,
      p_rows: [
        { heading: "Lounge", label: "Walls", surfaceKey: "1:11", sort: 1 },
        { heading: "Pergola", label: "Walls", surfaceKey: "2:21", sort: 2 },
      ],
    });
    expect(seeded).toMatch(/^ok:/);

    const { data: frozen } = await sb.from("estimates")
      .select("builder_state, sent_snapshot, subtotal_cents, total_cents, accepted_total_cents, selected_options")
      .eq("id", estimateId).single();
    frozenRow = frozen as Record<string, unknown>;
  });

  test.afterAll(async () => {
    if (!db || !estimateId) return;
    await db.from("invoices").delete().eq("estimate_id", estimateId);
    await db.from("work_orders").delete().eq("estimate_id", estimateId);
    await db.from("follow_ups").delete().eq("estimate_id", estimateId);
    await db.from("estimate_events").delete().eq("estimate_id", estimateId);
    await db.from("estimates").delete().eq("id", estimateId);
  });

  test("staff draft the revision from the real builder", async ({ page }) => {
    // Clone-on-first-open, then the edit (the builder page does the same).
    await rpcAsJson(staff!, "wo_open_working_scope", { p_estimate_id: estimateId });
    expect(await rpcAs(staff!, "wo_save_working_scope", {
      p_estimate_id: estimateId, p_state: workingState,
    })).toBe("ok");

    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    await page.getByTestId("draft-variations").click();
    await expect(page.getByTestId("drafted-list").locator("li")).toHaveCount(2, { timeout: 20_000 });

    const { data: rows } = await db!.from("wo_variations")
      .select("id, credit, customer_token").eq("work_order_id", workOrderId)
      .not("revision_block_ref", "is", null);
    const vars = rows as { id: string; credit: boolean; customer_token: string }[];
    expect(vars).toHaveLength(2);
    creditId = vars.find((v) => v.credit)!.id;
    additionId = vars.find((v) => !v.credit)!.id;
  });

  async function signOnPage(page: import("@playwright/test").Page, token: string, name: string) {
    await page.goto(`/v/${token}`);
    await page.getByTestId("approve-variation").click();
    await page.getByTestId("sign-name").fill(name);
    await drawSignature(page);
    await page.getByTestId("confirm-sign").click();
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved");
  }

  test("the customer signs BOTH on the drawn pad", async ({ page }) => {
    const { data: rows } = await db!.from("wo_variations")
      .select("id, customer_token").in("id", [creditId, additionId]);
    const tokenOf = new Map((rows as { id: string; customer_token: string }[]).map((r) => [r.id, r.customer_token]));

    await signOnPage(page, tokenOf.get(additionId)!, "A4 Customer");
    await signOnPage(page, tokenOf.get(creditId)!, "A4 Customer");

    // The credit's strike landed; the addition struck nothing.
    const { data: struck } = await db!.from("wo_surfaces")
      .select("surface_key").eq("work_order_id", workOrderId).eq("removed_from_scope", true);
    expect((struck as { surface_key: string }[]).map((s) => s.surface_key)).toEqual(["2:21"]);
  });

  test("contractor accepts the addition and acknowledges the credit", async () => {
    expect(await rpcAs(staff!, "wo_release_variation", { p_variation_id: additionId })).toBe("ok:released");
    expect(await rpcAs(contractor!, "wo_contractor_accept_variation", { p_variation_id: additionId })).toBe("ok:accepted");
    expect(await rpcAs(contractor!, "wo_contractor_acknowledge_variation", { p_variation_id: creditId })).toBe("ok:acknowledged");
  });

  test("ledger = engine, final invoice = ledger, drift = 0, deltas = hours × rate", async () => {
    // 1. The ledger's adjusted contract IS the engine's working-scope total.
    const workingTotals = totalsOf(workingState.blocks);
    const ledger = await rpcAsJson<{
      accepted_total_cents: number; variations_cents: number;
      adjusted_contract_cents: number; invoiced_cents: number;
    }[]>(staff!, "invoice_ledger_staff", { p_estimate_id: estimateId });
    expect(ledger[0].adjusted_contract_cents).toBe(workingTotals.totalCents);
    expect(ledger[0].accepted_total_cents + ledger[0].variations_cents)
      .toBe(workingTotals.totalCents);

    // 2. The final invoice drafts to the ledger's figure, GST inc-anchored.
    expect(await rpcAs(staff!, "invoice_create_final", { p_estimate_id: estimateId })).toMatch(/^ok/);
    const { data: inv } = await db!.from("invoices")
      .select("id, total_inc_cents, gst_cents, subtotal_ex_cents")
      .eq("estimate_id", estimateId).eq("kind", "final").eq("status", "draft").single();
    const final = inv as { id: string; total_inc_cents: number; gst_cents: number; subtotal_ex_cents: number };
    const expectedTotal = ledger[0].adjusted_contract_cents - ledger[0].invoiced_cents;
    expect(final.total_inc_cents).toBe(expectedTotal);
    expect(final.gst_cents).toBe(gstFromIncCents(expectedTotal));
    expect(final.subtotal_ex_cents).toBe(expectedTotal - final.gst_cents);

    // 3. Each signed variation is its own line, GST backed OUT of the signed
    //    figure (never added on top), credit sign flipped — and the lines sum
    //    to the document's ex total exactly.
    const { data: lineRows } = await db!.from("invoice_lines")
      .select("source, source_ref, amount_ex_cents").eq("invoice_id", final.id);
    const lines = lineRows as { source: string; source_ref: string | null; amount_ex_cents: number }[];
    const { data: varRows } = await db!.from("wo_variations")
      .select("id, price_cents, credit, est_hours, contractor_rate_cents, contractor_delta_cents, status, needs_manual_deduction, deduction_cents")
      .in("id", [creditId, additionId]);
    const vars = varRows as {
      id: string; price_cents: number; credit: boolean; est_hours: string;
      contractor_rate_cents: number; contractor_delta_cents: number; status: string;
      needs_manual_deduction: boolean; deduction_cents: number | null;
    }[];
    for (const v of vars) {
      const line = lines.find((l) => l.source === "variation" && l.source_ref === v.id);
      expect(line, `variation ${v.id} has its own line`).toBeTruthy();
      const expectedEx = variationLineExCents(v.price_cents) * (v.credit ? -1 : 1);
      expect(line!.amount_ex_cents).toBe(expectedEx);
    }
    expect(lines.reduce((s, l) => s + l.amount_ex_cents, 0)).toBe(final.subtotal_ex_cents);

    // 4. The reconciliation banner's own arithmetic agrees: drift is zero.
    const drift = await rpcAsJson<number>(staff!, "invoice_final_drift_staff", { p_invoice_id: final.id });
    expect(Number(drift)).toBe(0);

    // 5. Contractor deltas: hours × the stamped rate, and the adjusted pay
    //    rule nets the acknowledged credit off the accepted addition.
    for (const v of vars) {
      expect(v.status).toBe("contractor_accepted");
      expect(v.contractor_delta_cents).toBe(Math.round(Number(v.est_hours) * v.contractor_rate_cents));
    }
    const pay: PayVariation[] = vars.map((v) => ({
      status: v.status, credit: v.credit,
      contractor_delta_cents: v.contractor_delta_cents,
      deduction_cents: v.deduction_cents,
      needs_manual_deduction: v.needs_manual_deduction,
    }));
    const add = vars.find((v) => !v.credit)!;
    const cred = vars.find((v) => v.credit)!;
    expect(contractorAdjustedCents(0, pay))
      .toBe(add.contractor_delta_cents - cred.contractor_delta_cents);
  });

  test("and the accepted estimate row never changed by a byte", async () => {
    const { data } = await db!.from("estimates")
      .select("builder_state, sent_snapshot, subtotal_cents, total_cents, accepted_total_cents, selected_options")
      .eq("id", estimateId).single();
    expect(data).toEqual(frozenRow);
  });
});
