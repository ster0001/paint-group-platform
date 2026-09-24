import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contractorIdForEmail, rpcAs, serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";
import { priceEstimateTotals, type PricingContext, type BlockInput } from "../lib/pricing/estimate";
import { revisionContractorPay } from "../lib/revision/contractorRate";
import type { RateItem, Product } from "../lib/pricing/types";

/**
 * Tom, 24 Sep 2026: "if I adjust the contractor rate in the revision working
 * scope before I send it out to them in the schedule, the rate offered is the
 * rate the contractor sees, and if it is updated before being sent out, the
 * contractor sees the new rate."
 *
 *   accepted estimate, job unsent → open the revision, set Contractor rate
 *   → Save → the job's pay (what the tray and the offer sheet show) is the
 *   accepted scope at that rate; a revision change drafted now carries the
 *   same rate; once a painter has the job, another rate change leaves the
 *   painter's figure alone and the save says so.
 *
 * Every figure asserted here comes from the same lib the server used.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");

const wall = (id: number) => ({ id, code: "WALL", coats: 2, count: 0, prepHr: 1, internalLabel: "Walls", clientLabel: "Walls" });
const AREA = (id: number, name: string, L: number, W: number, sid: number) => ({
  kind: "area", id, name, type: "Interior", areaType: "room", L, W, H: 2.4, surfaces: [wall(sid)],
});
const lounge = AREA(1, "Lounge", 5, 4, 11);
const garage = AREA(3, "Garage", 6, 6, 31);
const MODSEL = { "Level of Finish": "FIN-3" };
const acceptedState = { blocks: [lounge], modSel: MODSEL };

let estimateId = "";
let workOrderId = "";
let ctx: PricingContext | null = null;

test.describe.configure({ mode: "serial" });

test.describe("the revision's contractor rate is the painter's rate", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");
  test.skip(!staff, missingCreds("STAFF"));
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
    const totals = priceEstimateTotals(acceptedState.blocks as unknown as BlockInput[], ctx, { modSel: MODSEL, materials: {} });
    const token = `rate1test${Math.abs(Date.now() % 1e10)}${process.pid}`;
    const { data: est, error } = await sb.from("estimates").insert({
      title: "Contractor rate e2e", status: "sent", sent_at: new Date().toISOString(), level_of_finish: 3,
      share_token: token, rate_card_id: card.id, rate_card_version: card.version, total_cents: totals.totalCents,
      builder_state: acceptedState,
      sent_snapshot: {
        version: 1,
        company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
        estRef: "EST-RATE1", contactName: "Rate Customer", contactEmail: "",
        totals: { totalCents: totals.totalCents }, depositPct: 10,
        jobAddress: `7 Rate Test Pl ${process.pid}`, jobTitle: "Interior repaint", gstRatePct: 10,
        baseSubtotalCents: totals.netSubtotalCents,
        areas: [], lineItems: [], options: [], paints: [], inclusions: [], exclusions: [],
        proof: { rating: 4.9, reviews: 100, liability: "$20m", warrantyYears: 2 }, terms: "",
      },
    }).select("id").single();
    if (error) throw new Error(`fixture estimate: ${error.message}`);
    estimateId = (est as { id: string }).id;
    const accepted = await sb.rpc("accept_estimate", { p_token: token, p_name: "Rate E2E", p_options: [], p_total_cents: 0, p_deposit_cents: 0 });
    if (accepted.data !== "accepted") throw new Error(`accept: ${accepted.data}`);
    const { data: wo } = await sb.from("work_orders").select("id, contractor_payment_cents, contractor_id").eq("estimate_id", estimateId).single();
    workOrderId = (wo as { id: string }).id;
    expect((wo as { contractor_id: string | null }).contractor_id).toBeNull();
    // Issue set the base pay from the accepted document, at the card's rate.
    expect((wo as { contractor_payment_cents: number | null }).contractor_payment_cents).toBe(totals.contractorOfferCents);
  });

  test.afterAll(async () => {
    if (!db || !estimateId) return;
    await db.from("invoices").delete().eq("estimate_id", estimateId);
    await db.from("work_orders").delete().eq("estimate_id", estimateId);
    await db.from("follow_ups").delete().eq("estimate_id", estimateId);
    await db.from("estimate_events").delete().eq("estimate_id", estimateId);
    await db.from("estimates").delete().eq("id", estimateId);
  });

  test("a new contractor rate, saved in the revision, is the job's pay while nobody has it", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    await expect(page.getByTestId("revision-badge")).toBeVisible();
    const rate = page.getByTestId("contractor-rate");
    await rate.scrollIntoViewIfNeeded();
    await rate.fill("75");
    await rate.blur();
    await page.getByTestId("builder-save").click();
    await expect(page.getByText(/Saved ✓ \(working scope\) · painter's price updated/)).toBeVisible({ timeout: 20_000 });

    const { data: scope } = await db!.from("wo_working_scopes").select("accepted_state, working_state").eq("estimate_id", estimateId).single();
    const s = scope as { accepted_state: Record<string, unknown>; working_state: Record<string, unknown> };
    expect(s.working_state.contractorRateOverride).toBe(75);
    const expected = revisionContractorPay(s.accepted_state, s.working_state, ctx!);
    expect(expected.rateCents).toBe(7500);

    const { data: wo } = await db!.from("work_orders").select("contractor_payment_cents, wo_snapshot").eq("id", workOrderId).single();
    const w = wo as { contractor_payment_cents: number; wo_snapshot: { contractorPaymentCents?: number } };
    expect(w.contractor_payment_cents).toBe(expected.baseCents);
    expect(w.wo_snapshot.contractorPaymentCents).toBe(expected.baseCents);
    // The board's tray reads the same column — so does the offer sheet's "Their price".
    await page.goto("/pc/schedule");
    await page.getByTestId("tray-search").fill("Rate Test Pl");
    await expect(page.getByTestId("tray-job").first()).toContainText("$" + Math.round(expected.baseCents / 100).toLocaleString("en-AU"));
  });

  test("a change drafted now carries the working scope's rate", async ({ page }) => {
    const saved = await rpcAs(staff!, "wo_save_working_scope", {
      p_estimate_id: estimateId, p_state: { blocks: [lounge, garage], modSel: MODSEL, contractorRateOverride: 75 },
    });
    expect(saved).toBe("ok");
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    await expect(page.getByTestId("revision-changes").locator("li")).toHaveCount(1);
    await page.getByTestId("draft-variations").click();
    await expect(page.getByTestId("drafted-list")).toBeVisible({ timeout: 20_000 });
    const { data: rows } = await db!.from("wo_variations")
      .select("est_hours, contractor_rate_cents, contractor_delta_cents, status")
      .eq("work_order_id", workOrderId).not("revision_block_ref", "is", null);
    const vars = rows as { est_hours: string; contractor_rate_cents: number; contractor_delta_cents: number; status: string }[];
    expect(vars).toHaveLength(1);
    expect(vars[0].contractor_rate_cents).toBe(7500);
    expect(vars[0].contractor_delta_cents).toBe(Math.round(Number(vars[0].est_hours) * 7500));
  });

  test("once a painter has the job, a later rate change leaves their figure alone", async ({ page }) => {
    const painterId = await contractorIdForEmail(db!, contractor!.email);
    expect(painterId).toBeTruthy();
    const { error } = await db!.from("work_orders").update({ contractor_id: painterId }).eq("id", workOrderId);
    expect(error).toBeNull();
    const before = (await db!.from("work_orders").select("contractor_payment_cents").eq("id", workOrderId).single()).data as { contractor_payment_cents: number };

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    const rate = page.getByTestId("contractor-rate");
    await rate.scrollIntoViewIfNeeded();
    await rate.fill("90");
    await rate.blur();
    await page.getByTestId("builder-save").click();
    await expect(page.getByText(/painter already has this job, their price unchanged/)).toBeVisible({ timeout: 20_000 });

    const after = (await db!.from("work_orders").select("contractor_payment_cents").eq("id", workOrderId).single()).data as { contractor_payment_cents: number };
    expect(after.contractor_payment_cents).toBe(before.contractor_payment_cents);
    const { data: rows } = await db!.from("wo_variations").select("contractor_rate_cents").eq("work_order_id", workOrderId).not("revision_block_ref", "is", null);
    expect((rows as { contractor_rate_cents: number }[])[0].contractor_rate_cents).toBe(7500);
  });
});
