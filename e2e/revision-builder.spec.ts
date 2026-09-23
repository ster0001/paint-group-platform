import { test, expect } from "@playwright/test";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { rpcAs, rpcAsJson, serviceClient } from "./fixtures/woLoop";
import { credentials, drawSignature, missingCreds, signIn } from "./helpers";
import { priceEstimateTotals, type PricingContext, type BlockInput } from "../lib/pricing/estimate";
import { diffRevision, type RevisionState } from "../lib/revision/diff";
import type { RateItem, Product } from "../lib/pricing/types";

/**
 * Addendum A2, AS STAFF: the revision builder over the working scope.
 *
 *   accepted estimate → open ?mode=revision (clone-on-first-open, no changes)
 *   → remove the pergola + add the garage → two ENGINE-priced variations
 *   drafted (credit included) as ONE offer behind one link (20270192) → the
 *   anonymous customer sees the list and the net figure and signs ONCE → both
 *   rows are approved, the pergola's tick-row is struck, the ledger moves —
 *   and because nobody is on the job yet, both changes fold straight in
 *   (contractor_accepted) and the painter's sheet lists them. Through all of
 *   it the accepted estimate row stays byte-identical.
 *
 * Every price asserted here is computed by the same lib the server used —
 * the spec never types a dollar figure of its own.
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const customer = credentials("CUSTOMER");

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
let woShareToken = "";
let offerToken = "";
let ctx: PricingContext | null = null;
let frozenRow: Record<string, unknown> | null = null;
let estimateShareToken = "";

test.describe.configure({ mode: "serial" });

test.describe("the revision builder — diff → signed variations", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!customer, missingCreds("CUSTOMER"));

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

    // The snapshot's total is the ENGINE's total for the accepted blocks, so
    // accepted_total_cents and the diff baseline agree to the cent.
    const totals = priceEstimateTotals(acceptedState.blocks as unknown as BlockInput[], ctx, {
      modSel: MODSEL, materials: {},
    });

    estimateShareToken = `rev1test${Math.abs(Date.now() % 1e10)}${process.pid}`;
    const token = estimateShareToken;
    const { data: est, error } = await sb.from("estimates").insert({
      title: "Revision e2e",
      status: "sent",
      sent_at: new Date().toISOString(), // /e gates on sent_at, not status
      level_of_finish: 3,
      share_token: token,
      rate_card_id: card.id,
      rate_card_version: card.version,
      total_cents: totals.totalCents,
      builder_state: acceptedState,
      sent_snapshot: {
        // A VALID customer snapshot — /e refuses anything else (version guard),
        // and the changes test walks the real customer page.
        version: 1,
        company: {
          name: "Paint Group", addressLine1: "", addressLine2: "", phone: "",
          abn: "", email: "", estimatorName: "", estimatorTitle: "",
          estimatorPhone: "", logoUrl: "",
        },
        estRef: "EST-REV1",
        contactName: "Revision Customer",
        contactEmail: "",
        totals: { totalCents: totals.totalCents },
        depositPct: 10,
        jobAddress: `9 Revision Test Pl ${process.pid}`,
        jobTitle: "Interior repaint",
        gstRatePct: 10,
        baseSubtotalCents: totals.netSubtotalCents,
        areas: [], lineItems: [], options: [], paints: [],
        inclusions: [], exclusions: [],
        proof: { rating: 4.9, reviews: 100, liability: "$20m", warrantyYears: 2 },
        terms: "",
      },
    }).select("id").single();
    if (error) throw new Error(`fixture estimate: ${error.message}`);
    estimateId = (est as { id: string }).id;

    const accepted = await sb.rpc("accept_estimate", {
      p_token: token, p_name: "Revision E2E", p_options: [],
      p_total_cents: 0, p_deposit_cents: 0,
    });
    if (accepted.data !== "accepted") throw new Error(`accept: ${accepted.data}`);

    const { data: wo } = await sb.from("work_orders").select("id, share_token").eq("estimate_id", estimateId).single();
    workOrderId = (wo as { id: string }).id;
    woShareToken = (wo as { share_token: string }).share_token;

    // The painter's tick list, keyed the way the strike matches.
    const seeded = await rpcAs(staff!, "wo_seed_surfaces", {
      p_work_order_id: workOrderId,
      p_rows: [
        { heading: "Lounge", label: "Walls", surfaceKey: "1:11", sort: 1 },
        { heading: "Pergola", label: "Walls", surfaceKey: "2:21", sort: 2 },
      ],
    });
    expect(seeded).toMatch(/^ok:/);
  });

  test.afterAll(async () => {
    if (!db || !estimateId) return;
    await db.from("invoices").delete().eq("estimate_id", estimateId);
    await db.from("work_orders").delete().eq("estimate_id", estimateId);
    await db.from("follow_ups").delete().eq("estimate_id", estimateId);
    await db.from("estimate_events").delete().eq("estimate_id", estimateId);
    await db.from("estimates").delete().eq("id", estimateId);
  });

  test("opens over a clean clone — no changes, revision badge on", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    await expect(page.getByTestId("revision-badge")).toBeVisible();
    await expect(page.getByTestId("revision-no-changes")).toBeVisible();

    // The row we must be able to prove byte-identical at the end.
    const { data } = await db!.from("estimates")
      .select("builder_state, sent_snapshot, subtotal_cents, total_cents, accepted_total_cents, selected_options")
      .eq("id", estimateId).single();
    frozenRow = data as Record<string, unknown>;
  });

  test("every door leads here: invoices tab, money view, locked builder", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);

    // The Invoicing tab (estimates-style list): the job's ADDRESS is the door.
    await page.goto("/invoices");
    // Row wording since 8790fd8 (25 Aug): "Draft · Deposit — 10% of $X · $Y · draft".
    await expect(page.getByTestId(`job-${estimateId}`)).toContainText("Deposit");
    await expect(page.getByTestId(`job-${estimateId}`)).toContainText("draft");
    await page.getByTestId(`revise-${estimateId}`).click();
    await expect(page.getByTestId("revision-badge")).toBeVisible();

    // From the job's money view…
    await page.goto(`/invoicing/job/${estimateId}`);
    await page.getByTestId("revision-builder-link").click();
    await expect(page.getByTestId("revision-badge")).toBeVisible();

    // …and from the locked estimate builder itself.
    await page.goto(`/quote?id=${estimateId}`);
    await page.getByTestId("open-revision").click();
    await expect(page.getByTestId("revision-badge")).toBeVisible();

    // View invoice: the customer-doc preview, headed as an INVOICE (Tom,
    // 24 Aug close-off) and built live from the working scope.
    await page.getByTestId("view-invoice").click();
    const preview = page.getByTestId("invoice-preview");
    await expect(preview).toBeVisible();
    // THE white A4 sheet — the same component /i/[token] prints as the PDF —
    // fed live from the working scope. No estimate anything.
    await expect(preview.getByTestId("invoice-sheet")).toBeVisible();
    await expect(preview).toContainText("TAX INVOICE");
    await expect(preview.getByTestId("invoice-number")).toHaveText("DRAFT");
    await expect(preview).toContainText("Live from the working scope");
    await expect(preview).toContainText("How to pay — bank transfer");
    await expect(preview.getByTestId("total-inc")).toBeVisible();
    await expect(preview).not.toContainText("Accept estimate");
    await page.getByTestId("back-to-revision").click();
    await expect(page.getByTestId("revision-panel")).toBeVisible();
  });

  test("remove the pergola, add the garage → two engine-priced drafts", async ({ page }) => {
    // The edit, saved the way the builder saves it.
    const saved = await rpcAs(staff!, "wo_save_working_scope", {
      p_estimate_id: estimateId, p_state: workingState,
    });
    expect(saved).toBe("ok");

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    await expect(page.getByTestId("revision-changes")).toBeVisible();
    await expect(page.getByTestId("revision-changes").locator("li")).toHaveCount(2);

    await page.getByTestId("draft-variations").click();
    await expect(page.getByTestId("drafted-list")).toBeVisible({ timeout: 20_000 });
    // Two changes, ONE offer: one row with the net figure and one link, the
    // two changes listed under it.
    await expect(page.getByTestId("offer-row")).toHaveCount(1);
    await expect(page.getByTestId("offer-items").locator("li")).toHaveCount(2);
    await expect(page.getByTestId("offer-row")).toContainText("2 changes");
    await expect(page.getByTestId("copy-link-offer")).toHaveCount(1);
    await expect(page.getByTestId("send-email-offer")).toHaveCount(1);

    // The engine is the only authority on the figures.
    const expected = diffRevision(acceptedState as RevisionState, workingState as RevisionState, ctx!);
    expect(expected.changes).toHaveLength(2);
    const expectedRemoval = expected.changes.find((c) => c.kind === "removed")!;
    const expectedAddition = expected.changes.find((c) => c.kind === "added")!;
    const net = expectedAddition.priceIncCents - expectedRemoval.priceIncCents;
    await expect(page.getByTestId("offer-total")).toContainText(
      "$" + (Math.abs(net) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

    const { data: rows } = await db!.from("wo_variations")
      .select("revision_block_ref, category, status, credit, price_cents, est_hours, contractor_rate_cents, contractor_delta_cents, surface_keys, customer_token")
      .eq("work_order_id", workOrderId).not("revision_block_ref", "is", null);
    const vars = rows as {
      revision_block_ref: string; category: string; status: string; credit: boolean;
      price_cents: number; est_hours: string; contractor_rate_cents: number;
      contractor_delta_cents: number; surface_keys: string[] | null; customer_token: string;
    }[];
    expect(vars).toHaveLength(2);
    // One token between them — the offer.
    expect(vars[0].customer_token).toBe(vars[1].customer_token);
    expect(vars[0].customer_token.length).toBeGreaterThanOrEqual(24);
    offerToken = vars[0].customer_token;

    const removal = vars.find((v) => v.credit)!;
    expect(removal.revision_block_ref).toBe("block:2");
    expect(removal.category).toBe("scope_removed");
    expect(removal.status).toBe("priced");
    expect(removal.price_cents).toBe(expectedRemoval.priceIncCents);
    expect(removal.surface_keys).toEqual(["2:21"]);
    expect(Number(removal.est_hours)).toBe(expectedRemoval.hours);

    const addition = vars.find((v) => !v.credit)!;
    expect(addition.revision_block_ref).toBe("block:3");
    expect(addition.category).toBe("extra_scope");
    expect(addition.price_cents).toBe(expectedAddition.priceIncCents);
    expect(Number(addition.est_hours)).toBe(expectedAddition.hours);
    // hours × the stamped rate, computed by the database.
    expect(addition.contractor_delta_cents)
      .toBe(Math.round(Number(addition.est_hours) * addition.contractor_rate_cents));
  });

  test("the anonymous customer sees the list and the net figure, and signs ONCE", async ({ page }) => {
    const expected = diffRevision(acceptedState as RevisionState, workingState as RevisionState, ctx!);
    const removal = expected.changes.find((c) => c.kind === "removed")!;
    const addition = expected.changes.find((c) => c.kind === "added")!;
    const net = addition.priceIncCents - removal.priceIncCents;
    const fmt = (c: number) => "$" + (Math.abs(c) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // No session: the link is the authorisation, exactly as for an estimate.
    await page.goto(`/v/${offerToken}`);
    await expect(page.getByTestId("offer-item")).toHaveCount(2);
    await expect(page.getByTestId("offer-summary")).toBeVisible();
    await expect(page.getByTestId("offer-summary").getByTestId("variation-price")).toHaveText((net < 0 ? "−" : "") + fmt(net));
    // One decision for the list — never two approve buttons.
    await expect(page.getByTestId("approve-variation")).toHaveCount(1);
    await expect(page.getByTestId("approve-variation")).toContainText("Approve all 2");

    await page.getByTestId("approve-variation").click();
    await page.getByTestId("sign-name").fill("Revision Customer");
    await drawSignature(page);
    await page.getByTestId("confirm-sign").click();
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved");
    await expect(page.getByTestId("variation-outcome")).toContainText("All 2 changes");

    // Both rows signed by the one signature; the pergola's row is struck.
    const { data: rowsAfter } = await db!.from("wo_variations")
      .select("id, credit, status, signed_name, price_cents, contractor_accepted_at")
      .eq("work_order_id", workOrderId).not("revision_block_ref", "is", null);
    const vars = rowsAfter as { id: string; credit: boolean; status: string; signed_name: string | null; price_cents: number; contractor_accepted_at: string | null }[];
    expect(vars).toHaveLength(2);
    for (const v of vars) {
      expect(v.signed_name).toBe("Revision Customer");
      // Nobody is on this job (no offer, no contractor, no assignment), so a
      // signed change just gets added in — it lands where a painter's accept
      // would have put it (Tom, 23 Sep).
      expect(v.status).toBe("contractor_accepted");
      expect(v.contractor_accepted_at).not.toBeNull();
    }
    const credit = vars.find((v) => v.credit)!;

    // The strike on the pergola — and the garage's walls are now a TICK ROW
    // under their own heading (20270193), marked by the addition that
    // brought them, so the painter's list, progress and stage gate all
    // carry the work the customer just signed for.
    const additionRow = vars.find((v) => !v.credit)!;
    const { data: surfaces } = await db!.from("wo_surfaces")
      .select("surface_key, heading, label, state, removed_from_scope, removed_by_variation, added_by_variation")
      .eq("work_order_id", workOrderId).order("surface_key");
    expect(surfaces).toEqual([
      { surface_key: "1:11", heading: "Lounge", label: "Walls", state: "todo", removed_from_scope: false, removed_by_variation: null, added_by_variation: null },
      { surface_key: "2:21", heading: "Pergola", label: "Walls", state: "todo", removed_from_scope: true, removed_by_variation: credit.id, added_by_variation: null },
      { surface_key: "3:31", heading: "Garage", label: "Walls", state: "todo", removed_from_scope: false, removed_by_variation: null, added_by_variation: additionRow.id },
    ]);

    // The fold-in is on the record.
    const { data: events } = await db!.from("wo_events")
      .select("type").eq("work_order_id", workOrderId).eq("type", "variation_folded_into_offer");
    expect(events).toHaveLength(2);

    // adjusted contract = accepted + the signed addition − the signed credit, from the ledger itself.
    const { data: est } = await db!.from("estimates")
      .select("accepted_total_cents").eq("id", estimateId).single();
    const ledger = await rpcAsJson<{ adjusted_contract_cents: number }[]>(
      staff!, "invoice_ledger_staff", { p_estimate_id: estimateId });
    expect(ledger[0].adjusted_contract_cents)
      .toBe(((est as { accepted_total_cents: number }).accepted_total_cents) + net);

    // A second visit to the same link: answered, no decision offered.
    await page.goto(`/v/${offerToken}`);
    await expect(page.getByTestId("approve-variation")).toHaveCount(0);
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved");
  });

  test("the painter's token read lists both changes — scope and hours, never a price", async () => {
    // This fixture accepts without a builder woDoc, so there is no frozen
    // sheet to render at /w; the RENDERED section is proved on the loop
    // fixture in wo-variations.spec.ts. Here: the token read the sheet
    // uses, as the anonymous caller the painter's link is.
    // The read serves ISSUED jobs only (a sheet nobody has been sent is not a
    // sheet); this fixture accepted with no woDoc, so issue it here.
    const issued = await db!.from("work_orders").update({ issued_at: new Date().toISOString() }).eq("id", workOrderId);
    expect(issued.error).toBeNull();

    const anon = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } });
    const { data, error } = await anon.rpc("get_work_order_scope_changes_by_token", { p_token: woShareToken });
    expect(error).toBeNull();
    const rows = data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.credit).sort()).toEqual([false, true]);
    for (const r of rows) {
      expect(r.status).toBe("contractor_accepted");
      expect(Object.keys(r)).not.toContain("price_cents");
      expect(Object.keys(r)).not.toContain("contractor_delta_cents");
      expect(Object.keys(r)).not.toContain("priced_lines");
    }
    // A stranger's token reads nothing, not an error.
    const stranger = await anon.rpc("get_work_order_scope_changes_by_token", { p_token: "not-a-token-" + Date.now() });
    expect(stranger.error).toBeNull();
    expect(stranger.data).toEqual([]);
  });

  test("the customer's own page shows the change and the updated total", async ({ page }) => {
    // /v for the signed offer now offers the way back…
    await page.goto(`/v/${offerToken}`);
    await expect(page.getByTestId("back-to-invoice")).toBeVisible();

    // …and /e carries both changes as signed — nothing left to sign — and
    // the ledger's adjusted total to the cent.
    await page.goto(`/e/${estimateShareToken}`);
    const section = page.getByTestId("customer-changes");
    await expect(section).toBeVisible();
    await expect(section).toContainText("Signed by Revision Customer");
    await expect(section.getByRole("link", { name: /Review & sign/ })).toHaveCount(0);

    const ledger = await rpcAsJson<{ adjusted_contract_cents: number }[]>(
      staff!, "invoice_ledger_staff", { p_estimate_id: estimateId });
    const expected = "$" + (ledger[0].adjusted_contract_cents / 100)
      .toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await expect(page.getByTestId("updated-total")).toContainText(expected);
  });

  test("re-drafting after the signature drafts only what goes beyond it", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    await page.getByTestId("draft-variations").click();
    await expect(page.getByTestId("revision-message")).toBeVisible({ timeout: 20_000 });

    // Both signed rows are untouched and no fresh draft appears for either
    // block — the working scope matches what was signed.
    await expect(page.getByTestId("revision-message")).toContainText("Nothing to draft");
    const { data: rows } = await db!.from("wo_variations")
      .select("revision_block_ref, status, credit")
      .eq("work_order_id", workOrderId).not("revision_block_ref", "is", null);
    const vars = rows as { revision_block_ref: string; status: string; credit: boolean }[];
    expect(vars.filter((v) => v.revision_block_ref === "block:2")).toHaveLength(1);
    expect(vars.find((v) => v.revision_block_ref === "block:2")?.status).toBe("contractor_accepted");
    expect(vars.filter((v) => v.revision_block_ref === "block:3")).toHaveLength(1);
    expect(vars.find((v) => v.revision_block_ref === "block:3")?.status).toBe("contractor_accepted");
  });

  test("through all of it, the accepted estimate row is byte-identical", async () => {
    const { data } = await db!.from("estimates")
      .select("builder_state, sent_snapshot, subtotal_cents, total_cents, accepted_total_cents, selected_options")
      .eq("id", estimateId).single();
    expect(data).toEqual(frozenRow);
  });
});
