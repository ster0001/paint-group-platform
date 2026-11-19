import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcAs, rpcAsJson, serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn, drawSignature, test } from "./helpers";
import { priceEstimateTotals, type PricingContext, type BlockInput } from "../lib/pricing/estimate";
import type { RateItem, Product } from "../lib/pricing/types";
import { variationLineExCents } from "../lib/invoicing/variation";

/**
 * 20 Nov 2026: signed variations taken back
 * out of the revised scope stayed on the final invoice.
 *
 *   accept → a Garage added → drafted → the customer (ANONYMOUS, on /v) signs
 *   → the office takes the Garage back out of the working scope
 *   → the panel still lists it, as a credit for what was signed
 *   → drafted → the customer signs the credit
 *   → the ledger's adjusted contract is the engine's working total again, and
 *     the final invoice carries the Garage and its credit, netting to zero.
 *
 * It used to read "nothing to send": the Garage no longer differed from the
 * accepted scope, so nothing was drafted and the invoice charged for it.
 * Every expected figure comes from lib/pricing / lib/invoicing.
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");

const wall = (id: number) => ({ id, code: "WALL", coats: 2, count: 0, prepHr: 1, internalLabel: "Walls", clientLabel: "Walls" });
const AREA = (id: number, name: string, L: number, sid: number) =>
  ({ kind: "area", id, name, type: "Interior", areaType: "room", L, W: 4, H: 2.4, surfaces: [wall(sid)] });
const lounge = AREA(1, "Lounge", 5, 11);
const garage = AREA(3, "Garage", 6, 31);
const MODSEL = { "Level of Finish": "FIN-3" };
const acceptedState = { blocks: [lounge], modSel: MODSEL };

let estimateId = "";
let workOrderId = "";
let ctx: PricingContext | null = null;
let signedGarageCents = 0;

const totalOf = (blocks: unknown[]) =>
  priceEstimateTotals(blocks as BlockInput[], ctx!, { modSel: MODSEL, materials: {} }).totalCents;

async function offerToken(credit: boolean): Promise<string> {
  const { data, error } = await db!.from("wo_variations")
    .select("customer_token").eq("work_order_id", workOrderId).eq("status", "priced").eq("credit", credit);
  if (error) throw new Error(error.message);
  const rows = data as { customer_token: string }[];
  expect(rows).toHaveLength(1);
  return rows[0].customer_token;
}

test.describe.configure({ mode: "serial" });

test.describe("revision — a signed change taken back out is credited", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");
  test.skip(!staff, missingCreds("STAFF"));

  test.beforeAll(async () => {
    const sb = db!;
    const { data: card, error: cardErr } = await sb.from("rate_cards").select("id, version").eq("is_active", true).single();
    if (cardErr || !card) throw new Error(`no active rate card — run scripts/c1/seed.mjs (${cardErr?.message ?? "none"})`);
    const [ri, pr, mo, se] = await Promise.all([
      sb.from("rate_items").select("*").eq("rate_card_id", card.id),
      sb.from("products").select("*"),
      sb.from("modifiers").select("*").eq("active", true),
      sb.from("settings").select("key, value"),
    ]);
    for (const r of [ri, pr, mo, se]) if (r.error) throw new Error(r.error.message);
    ctx = {
      rateItems: (ri.data ?? []) as unknown as RateItem[],
      products: (pr.data ?? []) as unknown as Product[],
      modifiers: (mo.data ?? []) as PricingContext["modifiers"],
      settings: (se.data ?? []) as PricingContext["settings"],
    };
    const acceptedTotal = totalOf(acceptedState.blocks);
    const token = `revtakenout${Math.abs(Date.now() % 1e10)}${process.pid}`;
    const { data: est, error } = await sb.from("estimates").insert({
      title: "Revision signed taken out e2e",
      status: "sent",
      level_of_finish: 3,
      share_token: token,
      rate_card_id: card.id,
      rate_card_version: card.version,
      total_cents: acceptedTotal,
      builder_state: acceptedState,
      sent_snapshot: {
        totals: { totalCents: acceptedTotal }, depositPct: 10,
        jobAddress: `27 Taken Out St ${process.pid}`, jobTitle: "Interior repaint", gstRatePct: 10,
        baseSubtotalCents: acceptedTotal, areas: [], lineItems: [], options: [],
      },
    }).select("id").single();
    if (error) throw new Error(`fixture estimate: ${error.message}`);
    estimateId = (est as { id: string }).id;
    const acc = await sb.rpc("accept_estimate", { p_token: token, p_name: "Taken Out Customer", p_options: [], p_total_cents: 0, p_deposit_cents: 0 });
    if (acc.error || acc.data !== "accepted") throw new Error(`accept: ${acc.error?.message ?? acc.data}`);
    const { data: wo, error: woErr } = await sb.from("work_orders").select("id").eq("estimate_id", estimateId).single();
    if (woErr) throw new Error(woErr.message);
    workOrderId = (wo as { id: string }).id;
    await rpcAsJson(staff!, "wo_open_working_scope", { p_estimate_id: estimateId });
  });

  test.afterAll(async () => {
    if (!db || !estimateId) return;
    await db.from("invoices").delete().eq("estimate_id", estimateId);
    await db.from("wo_working_scopes").delete().eq("estimate_id", estimateId);
    await db.from("work_orders").delete().eq("estimate_id", estimateId);
    await db.from("follow_ups").delete().eq("estimate_id", estimateId);
    await db.from("estimate_events").delete().eq("estimate_id", estimateId);
    await db.from("estimates").delete().eq("id", estimateId);
  });

  test("the Garage is added, drafted, and signed by the customer", async ({ page, browser }) => {
    expect(await rpcAs(staff!, "wo_save_working_scope", {
      p_estimate_id: estimateId, p_state: { ...acceptedState, blocks: [lounge, garage] },
    })).toBe("ok");
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    await expect(page.getByTestId("revision-change-block-3")).toContainText("Garage — added");
    await page.getByTestId("draft-variations").click();
    await expect(page.getByTestId("offer-items").locator("li")).toHaveCount(1, { timeout: 20_000 });

    // The customer: a fresh context, no session — the link is all they have.
    const anon = await browser.newContext();
    const cust = await anon.newPage();
    await cust.goto(`/v/${await offerToken(false)}`);
    await cust.getByTestId("approve-variation").click();
    await cust.getByTestId("sign-name").fill("Taken Out Customer");
    await drawSignature(cust);
    await cust.getByTestId("confirm-sign").click();
    await expect(cust.getByTestId("variation-outcome")).toContainText("Approved");
    await anon.close();

    const { data, error } = await db!.from("wo_variations")
      .select("status, price_cents").eq("work_order_id", workOrderId).eq("revision_block_ref", "block:3");
    if (error) throw new Error(error.message);
    const rows = data as { status: string; price_cents: number }[];
    expect(rows).toHaveLength(1);
    expect(["customer_approved", "contractor_accepted"]).toContain(rows[0].status);
    signedGarageCents = rows[0].price_cents;
    expect(signedGarageCents).toBe(totalOf([lounge, garage]) - totalOf([lounge]));
  });

  test("taken back out → the panel still lists it as a credit, and it drafts", async ({ page }) => {
    expect(await rpcAs(staff!, "wo_save_working_scope", {
      p_estimate_id: estimateId, p_state: acceptedState,
    })).toBe("ok");
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    const row = page.getByTestId("revision-change-block-3");
    await expect(row).toContainText("Garage — signed change taken back out");
    await expect(row).toContainText(`− $${(signedGarageCents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`);
    await expect(page.getByTestId("revision-no-changes")).toHaveCount(0);
    // Undoing it would change nothing — the section already IS the accepted one.
    await expect(page.getByTestId("revision-undo-block-3")).toHaveCount(0);

    await page.getByTestId("draft-variations").click();
    await expect(page.getByTestId("offer-items").locator("li")).toHaveCount(1, { timeout: 20_000 });
    const { data, error } = await db!.from("wo_variations")
      .select("price_cents, credit, status, surface_keys").eq("work_order_id", workOrderId).eq("status", "priced");
    if (error) throw new Error(error.message);
    const drafts = data as { price_cents: number; credit: boolean; surface_keys: string[] | null }[];
    expect(drafts).toHaveLength(1);
    expect(drafts[0].credit).toBe(true);
    expect(drafts[0].price_cents).toBe(signedGarageCents);
    expect(drafts[0].surface_keys).toEqual(["3:31"]);
  });

  test("the customer signs the credit → the final invoice nets the Garage to zero", async ({ browser }) => {
    const anon = await browser.newContext();
    const cust = await anon.newPage();
    await cust.goto(`/v/${await offerToken(true)}`);
    await cust.getByTestId("approve-variation").click();
    await cust.getByTestId("sign-name").fill("Taken Out Customer");
    await drawSignature(cust);
    await cust.getByTestId("confirm-sign").click();
    await expect(cust.getByTestId("variation-outcome")).toContainText("Approved");
    await anon.close();

    const ledger = await rpcAsJson<{ adjusted_contract_cents: number; invoiced_cents: number }[]>(
      staff!, "invoice_ledger_staff", { p_estimate_id: estimateId });
    expect(ledger[0].adjusted_contract_cents).toBe(totalOf(acceptedState.blocks));

    expect(await rpcAs(staff!, "invoice_create_final", { p_estimate_id: estimateId })).toMatch(/^ok/);
    const { data: inv, error } = await db!.from("invoices")
      .select("id, total_inc_cents").eq("estimate_id", estimateId).eq("kind", "final").eq("status", "draft").single();
    if (error) throw new Error(error.message);
    const final = inv as { id: string; total_inc_cents: number };
    expect(final.total_inc_cents).toBe(ledger[0].adjusted_contract_cents - ledger[0].invoiced_cents);

    const { data: lineRows, error: linesErr } = await db!.from("invoice_lines")
      .select("source, amount_ex_cents").eq("invoice_id", final.id).eq("source", "variation");
    if (linesErr) throw new Error(linesErr.message);
    const amounts = (lineRows as { amount_ex_cents: number }[]).map((l) => l.amount_ex_cents).sort((a, b) => a - b);
    const ex = variationLineExCents(signedGarageCents);
    expect(amounts).toEqual([-ex, ex]);
  });
});
