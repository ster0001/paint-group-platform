import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contractorIdForEmail, rpcAs, serviceClient } from "./fixtures/woLoop";
import { credentials, drawSignature, missingCreds, signIn } from "./helpers";
import { priceEstimateTotals, type PricingContext, type BlockInput } from "../lib/pricing/estimate";
import type { RateItem, Product } from "../lib/pricing/types";

/**
 * 12A Cavell Court, Tom 7 Oct 2026: a painter's request priced in the working
 * scope IS that request.
 *
 *   painter raises a variation on a job they hold
 *   → the office opens the builder FROM that request (?variation=) and
 *     prices the change in the working scope → the painter's own row is the
 *     priced change (no second row), with the customer
 *   → the office backs the change out → the request is 'raised' again, not cancelled
 *   → priced again → the anonymous customer signs the offer → the row is
 *     customer_approved and RELEASED to the painter (20270220), and the job's
 *     record says what the notification came to
 *   → the painter sees "Variation approved by the client" on their own
 *     request and accepts it.
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
const workingState = { blocks: [lounge, garage], modSel: MODSEL };

let estimateId = "";
let workOrderId = "";
let requestId = "";
let offerToken = "";
let contractorId = "";

test.describe.configure({ mode: "serial" });

test.describe("a painter's request, priced in the working scope", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));

  test.beforeAll(async () => {
    const sb = db!;
    const cid = await contractorIdForEmail(sb, contractor!.email);
    if (!cid) throw new Error(`no contractors row for ${contractor!.email}`);
    contractorId = cid;
    const { data: crow } = await sb.from("contractors").select("profile_id").eq("id", cid).single();
    const painterProfileId = (crow as { profile_id: string }).profile_id;

    const { data: card } = await sb.from("rate_cards").select("id, version").eq("is_active", true).single();
    if (!card) throw new Error("no active rate card — run scripts/c1/seed.mjs");
    const [ri, pr, mo, se] = await Promise.all([
      sb.from("rate_items").select("*").eq("rate_card_id", card.id),
      sb.from("products").select("*"),
      sb.from("modifiers").select("*").eq("active", true),
      sb.from("settings").select("key, value"),
    ]);
    const ctx: PricingContext = {
      rateItems: (ri.data ?? []) as unknown as RateItem[],
      products: (pr.data ?? []) as unknown as Product[],
      modifiers: (mo.data ?? []) as PricingContext["modifiers"],
      settings: (se.data ?? []) as PricingContext["settings"],
    };
    const totals = priceEstimateTotals(acceptedState.blocks as unknown as BlockInput[], ctx, { modSel: MODSEL, materials: {} });

    const token = `reqpriced${Math.abs(Date.now() % 1e10)}${process.pid}`;
    const { data: est, error } = await sb.from("estimates").insert({
      title: "Request priced in scope e2e", status: "sent", sent_at: new Date().toISOString(),
      level_of_finish: 3, share_token: token, rate_card_id: card.id, rate_card_version: card.version,
      total_cents: totals.totalCents, builder_state: acceptedState,
      sent_snapshot: {
        version: 1,
        company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
        estRef: "EST-REQ1", contactName: "Request Customer", contactEmail: "",
        totals: { totalCents: totals.totalCents }, depositPct: 10,
        jobAddress: `12A Request Test Ct ${process.pid}`, jobTitle: "Exterior repaint", gstRatePct: 10,
        baseSubtotalCents: totals.netSubtotalCents,
        areas: [], lineItems: [], options: [], paints: [], inclusions: [], exclusions: [],
        proof: { rating: 4.9, reviews: 100, liability: "$20m", warrantyYears: 2 }, terms: "",
      },
    }).select("id").single();
    if (error) throw new Error(`fixture estimate: ${error.message}`);
    estimateId = (est as { id: string }).id;

    const accepted = await sb.rpc("accept_estimate", { p_token: token, p_name: "Request E2E", p_options: [], p_total_cents: 0, p_deposit_cents: 0 });
    if (accepted.data !== "accepted") throw new Error(`accept: ${accepted.data}`);
    const { data: wo } = await sb.from("work_orders").select("id").eq("estimate_id", estimateId).single();
    workOrderId = (wo as { id: string }).id;

    // The painter HOLDS the job (wo_has_painter = contractor_id), under way.
    const { error: woErr } = await sb.from("work_orders")
      .update({ contractor_id: cid, stage: "in_progress", stage_entered_at: new Date().toISOString() })
      .eq("id", workOrderId);
    if (woErr) throw new Error(`fixture painter: ${woErr.message}`);
    const seeded = await rpcAs(staff!, "wo_seed_surfaces", {
      p_work_order_id: workOrderId,
      p_rows: [{ heading: "Lounge", label: "Walls", surfaceKey: "1:11", sort: 1 }],
    });
    expect(seeded).toMatch(/^ok:/);

    // Their request, in their words.
    const { data: raised, error: rErr } = await sb.from("wo_variations").insert({
      work_order_id: workOrderId, raised_by: painterProfileId, raised_kind: "contractor",
      category: "extra_scope", comment: "Ivy walls to the right and left of the front door", status: "raised",
    }).select("id").single();
    if (rErr) throw new Error(`fixture request: ${rErr.message}`);
    requestId = (raised as { id: string }).id;
  });

  test.afterAll(async () => {
    if (!db || !estimateId) return;
    await db.from("invoices").delete().eq("estimate_id", estimateId);
    await db.from("work_orders").delete().eq("estimate_id", estimateId);
    await db.from("follow_ups").delete().eq("estimate_id", estimateId);
    await db.from("estimate_events").delete().eq("estimate_id", estimateId);
    await db.from("estimates").delete().eq("id", estimateId);
  });

  async function request() {
    const { data } = await db!.from("wo_variations")
      .select("status, revision_block_ref, customer_token, request_priced_at, released_at, contractor_accepted_at, price_cents, est_hours, comment, raised_kind")
      .eq("id", requestId).single();
    return data as {
      status: string; revision_block_ref: string | null; customer_token: string | null; request_priced_at: string | null;
      released_at: string | null; contractor_accepted_at: string | null; price_cents: number | null; est_hours: string | null;
      comment: string; raised_kind: string;
    };
  }

  test("the builder opened from the request prices THAT row — no second variation", async ({ page }) => {
    const saved = await rpcAs(staff!, "wo_save_working_scope", { p_estimate_id: estimateId, p_state: workingState });
    expect(saved).toBe("ok");

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision&variation=${requestId}`);
    await expect(page.getByTestId("revision-request")).toContainText("Ivy walls");
    await expect(page.getByTestId("revision-changes").locator("li")).toHaveCount(1);

    await page.getByTestId("draft-variations").click();
    await expect(page.getByTestId("drafted-list")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("offer-row")).toContainText("1 change");

    const v = await request();
    expect(v.status).toBe("priced");
    expect(v.revision_block_ref).not.toBeNull();
    expect(v.customer_token).not.toBeNull();
    expect(v.request_priced_at).not.toBeNull();
    expect(v.raised_kind).toBe("contractor");
    expect(v.comment).toContain("Ivy walls");          // the painter's words stay first
    expect(Number(v.est_hours)).toBeGreaterThan(0);
    expect(v.price_cents).toBeGreaterThan(0);
    offerToken = v.customer_token!;

    const { data: rows } = await db!.from("wo_variations").select("id").eq("work_order_id", workOrderId);
    expect(rows).toHaveLength(1);   // one record, not a request + a draft

    // The job page no longer offers to price it: it is with the customer.
    await page.goto(`/pc/wo/${workOrderId}`);
    await expect(page.getByTestId(`price-in-builder-${requestId}`)).toHaveCount(0);
  });

  test("backing the change out puts the request back to raised, not cancelled", async ({ page }) => {
    const saved = await rpcAs(staff!, "wo_save_working_scope", { p_estimate_id: estimateId, p_state: acceptedState });
    expect(saved).toBe("ok");
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    await expect(page.getByTestId("revision-no-changes")).toBeVisible();
    // The retire path runs from the draft action — no diff, so the button is
    // off; the action is reached the way the builder reaches it.
    const sb = db!;
    const retired = await rpcAs(staff!, "wo_draft_revision_variation", {
      p_estimate_id: estimateId, p_block_ref: (await request()).revision_block_ref, p_category: "extra_scope",
      p_comment: "retired", p_credit: false, p_surface_keys: [], p_price_cents: 0, p_inputs: {},
      p_priced_lines: [], p_hours: 0,
    });
    expect(retired).toBe("ok:cancelled");
    const v = await request();
    expect(v.status).toBe("raised");
    expect(v.revision_block_ref).toBeNull();
    expect(v.customer_token).toBeNull();
    expect(v.request_priced_at).toBeNull();
    const { data: ev } = await sb.from("wo_events").select("type").eq("work_order_id", workOrderId);
    expect((ev ?? []).map((e) => (e as { type: string }).type)).toContain("variation_request_unpriced");
  });

  test("priced again, signed by the customer → released to the painter, and the record says who was told", async ({ page }) => {
    const saved = await rpcAs(staff!, "wo_save_working_scope", { p_estimate_id: estimateId, p_state: workingState });
    expect(saved).toBe("ok");
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision&variation=${requestId}`);
    await page.getByTestId("draft-variations").click();
    await expect(page.getByTestId("drafted-list")).toBeVisible({ timeout: 20_000 });
    const priced = await request();
    expect(priced.status).toBe("priced");
    offerToken = priced.customer_token!;
    await page.context().clearCookies();

    // The anonymous customer signs the offer.
    await page.goto(`/v/${offerToken}`);
    await page.getByTestId("approve-variation").click();
    await drawSignature(page);
    await page.getByTestId("sign-name").fill("Request Customer");
    await page.getByTestId("confirm-sign").click();
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved");

    const v = await request();
    expect(v.status).toBe("customer_approved");
    expect(v.released_at).not.toBeNull();          // a painter on the job is ASKED (20270220)
    expect(v.contractor_accepted_at).toBeNull();

    // The painter notification was attempted and the job's record says what
    // it came to — notified, or skipped with the reason — never "notified"
    // over nothing (the Cavell Court failure).
    await expect.poll(async () => {
      const { data: ev } = await db!.from("wo_events").select("type, meta").eq("work_order_id", workOrderId);
      return (ev ?? []).map((e) => (e as { type: string }).type)
        .filter((t) => t === "variation_release_notified" || t === "variation_release_notified_skipped");
    }, { timeout: 15_000 }).toHaveLength(1);
    const { data: ev } = await db!.from("wo_events").select("type, meta").eq("work_order_id", workOrderId)
      .in("type", ["variation_release_notified", "variation_release_notified_skipped"]);
    const one = (ev ?? [])[0] as { type: string; meta: { variation_id: string; reason?: string; channels?: string[] } };
    expect(one.meta.variation_id).toBe(requestId);
    if (one.type === "variation_release_notified_skipped") expect(one.meta.reason).toBeTruthy();
    else expect(one.meta.channels?.length).toBeGreaterThan(0);
  });

  test("the painter accepts their own request, approved by the client", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${workOrderId}`);
    await expect(page.getByTestId(`approved-by-client-${requestId}`)).toBeVisible();
    await page.getByTestId(`accept-${requestId}`).click();
    await expect(page.getByTestId(`variation-${requestId}`)).toContainText("Accepted");
    const v = await request();
    expect(v.status).toBe("contractor_accepted");
    expect(v.contractor_accepted_at).not.toBeNull();
    expect(contractorId).toBeTruthy();
  });
});
