import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcAs, serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { priceEstimateTotals, type PricingContext, type BlockInput } from "../lib/pricing/estimate";
import type { RateItem, Product } from "../lib/pricing/types";

/**
 * Tom, 2 Nov 2026: "in revision, working scope, when clicking on invoice
 * please allow to convert to a pdf to download to send to a client who wants
 * to see costs — make sure pending variations are included also".
 *
 *   accepted estimate → working scope adds a Garage (a builder-drafted change
 *   still awaiting the customer) → PC Command quick-prices an "Extra door"
 *   (no block ref, also pending) → the INVOICE tab carries both: the door as
 *   its own line flagged "Awaiting your approval", the garage named in the
 *   note (it is already in the room prices) → Download PDF hands over a real
 *   PDF. An anonymous caller gets a 404; figures that are not the saved
 *   working scope get a 409.
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");

const wall = (id: number) => ({ id, code: "WALL", coats: 2, count: 0, prepHr: 1, internalLabel: "Walls", clientLabel: "Walls" });
const AREA = (id: number, name: string, L: number, W: number, sid: number) => ({
  kind: "area", id, name, type: "Interior", areaType: "room", L, W, H: 2.4, surfaces: [wall(sid)],
});
const MODSEL = { "Level of Finish": "FIN-3" };
const acceptedState = { blocks: [AREA(1, "Lounge", 5, 4, 11)], modSel: MODSEL };
const workingState = { blocks: [AREA(1, "Lounge", 5, 4, 11), AREA(3, "Garage", 6, 6, 31)], modSel: MODSEL };
const DOOR_INC = 11_000;

let estimateId = "";
let workingTotalCents = 0;
let workingNetCents = 0;

const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test.describe.configure({ mode: "serial" });

test.describe("revision INVOICE → PDF with pending variations", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");
  test.skip(!staff, missingCreds("STAFF"));

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
    const ctx: PricingContext = {
      rateItems: (ri.data ?? []) as unknown as RateItem[],
      products: (pr.data ?? []) as unknown as Product[],
      modifiers: (mo.data ?? []) as PricingContext["modifiers"],
      settings: (se.data ?? []) as PricingContext["settings"],
    };
    const accepted = priceEstimateTotals(acceptedState.blocks as unknown as BlockInput[], ctx, { modSel: MODSEL, materials: {} });
    const working = priceEstimateTotals(workingState.blocks as unknown as BlockInput[], ctx, { modSel: MODSEL, materials: {} });
    workingTotalCents = working.totalCents;
    workingNetCents = working.netSubtotalCents;

    const token = `revpdf${Math.abs(Date.now() % 1e10)}${process.pid}`;
    const { data: est, error } = await sb.from("estimates").insert({
      title: "Revision PDF e2e", status: "sent", sent_at: new Date().toISOString(),
      level_of_finish: 3, share_token: token, rate_card_id: card.id, rate_card_version: card.version,
      total_cents: accepted.totalCents, builder_state: acceptedState,
      sent_snapshot: {
        version: 1,
        company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
        estRef: "EST-REVPDF", contactName: "Pdf Customer", contactEmail: "",
        totals: { totalCents: accepted.totalCents }, depositPct: 10,
        jobAddress: `7 Pdf Test Pl ${process.pid}`, jobTitle: "Interior repaint", gstRatePct: 10,
        baseSubtotalCents: accepted.netSubtotalCents,
        areas: [], lineItems: [], options: [], paints: [], inclusions: [], exclusions: [],
        proof: { rating: 4.9, reviews: 100, liability: "$20m", warrantyYears: 2 }, terms: "",
      },
    }).select("id").single();
    if (error) throw new Error(`fixture estimate: ${error.message}`);
    estimateId = (est as { id: string }).id;

    const acc = await sb.rpc("accept_estimate", { p_token: token, p_name: "Pdf E2E", p_options: [], p_total_cents: 0, p_deposit_cents: 0 });
    if (acc.data !== "accepted") throw new Error(`accept: ${acc.data}`);
    const { data: wo } = await sb.from("work_orders").select("id").eq("estimate_id", estimateId).single();
    const workOrderId = (wo as { id: string }).id;

    // The working scope adds the garage, saved the way the builder saves it.
    expect(await rpcAs(staff!, "wo_save_working_scope", { p_estimate_id: estimateId, p_state: workingState })).toBe("ok");

    // Two pending variations: the garage drafted from the builder (already
    // inside the working scope's figures), and an extra door quick-priced on
    // PC Command (not in the working scope at all).
    const { error: vErr } = await sb.from("wo_variations").insert([
      { work_order_id: workOrderId, status: "priced", category: "extra_scope", comment: "Garage", revision_block_ref: "block:3",
        price_cents: working.totalCents - accepted.totalCents, credit: false },
      { work_order_id: workOrderId, status: "priced", category: "extra_scope", comment: "Extra door", price_cents: DOOR_INC, credit: false },
    ]);
    if (vErr) throw new Error(`fixture variations: ${vErr.message}`);
  });

  test.afterAll(async () => {
    if (!db || !estimateId) return;
    await db.from("invoices").delete().eq("estimate_id", estimateId);
    await db.from("work_orders").delete().eq("estimate_id", estimateId);
    await db.from("follow_ups").delete().eq("estimate_id", estimateId);
    await db.from("estimate_events").delete().eq("estimate_id", estimateId);
    await db.from("estimates").delete().eq("id", estimateId);
  });

  test("an anonymous caller gets a 404, never a PDF", async ({ request }) => {
    const res = await request.post("/api/quote/invoice-pdf", {
      data: { estimateId, header: { billed_to: "", job_address: "", job_title: "" }, contractLines: [], contractSubtotalExCents: 0 },
    });
    expect(res.status()).toBe(404);
  });

  test("the INVOICE tab carries both pending variations; the PDF downloads", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    await page.getByTestId("view-invoice").click();
    const preview = page.getByTestId("invoice-preview");
    await expect(preview.getByTestId("invoice-sheet")).toBeVisible();

    // The quick-priced door: its own line, flagged, in the total.
    await expect(preview).toContainText("Variation");
    await expect(preview).toContainText("Extra door");
    await expect(preview.getByTestId("line-pending")).toHaveCount(1);
    await expect(preview.getByTestId("line-pending")).toHaveText("Awaiting your approval");
    await expect(preview.getByTestId("total-inc")).toHaveText(money(workingTotalCents + DOOR_INC));

    // The garage: named in the customer's note, never added twice.
    const note = preview.getByTestId("revision-invoice-note");
    await expect(note).toContainText("2 changes still awaiting your approval");
    await expect(note.getByTestId("pending-in-scope")).toContainText("Garage");

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByTestId("download-invoice-pdf").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^invoice-7-pdf-test-pl-\d+\.pdf$/);
    const bytes = readFileSync((await download.path())!);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5_000);
    await expect(page.getByTestId("invoice-pdf-error")).toHaveCount(0);
  });

  test("figures that are not the saved working scope are refused (409)", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    const res = await page.request.post("/api/quote/invoice-pdf", {
      data: {
        estimateId, header: { billed_to: "X", job_address: "Y", job_title: "Z" },
        contractLines: [], contractSubtotalExCents: workingNetCents + 1,
      },
    });
    expect(res.status()).toBe(409);
  });
});
