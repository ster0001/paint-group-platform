import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn, test } from "./helpers";

/**
 * Tom, 12 Oct 2026 (28 Logan St), AS STAFF — the revision builder is a staff
 * screen; the customer only ever sees the signing link, which this spec never
 * reaches (nothing is drafted).
 *
 *  1. An accepted estimate with Preparation HOURS on it opens its revision
 *     over a clean clone and reads "nothing to send" — it used to read
 *     "Pricing adjustments changed · 4 hr" with nothing edited.
 *  2. Each change in the panel carries its own Undo: undoing one puts that
 *     section back to the accepted estimate, saves the working scope, and
 *     leaves the other change exactly where it was — across a reload.
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");

const wall = (id: number) => ({ id, code: "WALL", coats: 2, count: 0, prepHr: 1, internalLabel: "Walls", clientLabel: "Walls" });
const AREA = (id: number, name: string, L: number, sid: number) =>
  ({ kind: "area", id, name, type: "Interior", areaType: "room", L, W: 4, H: 2.4, surfaces: [wall(sid)] });
const lounge = AREA(1, "Lounge", 5, 11);
const pergola = AREA(2, "Pergola", 3, 21);
const garage = AREA(3, "Garage", 6, 31);

const accepted = { blocks: [lounge, pergola], modSel: { "Level of Finish": "FIN-3" }, preparationHours: 4 };

let estimateId = "";

test.describe.configure({ mode: "serial" });

test.describe("revision builder — undo one change at a time", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");
  test.skip(!staff, missingCreds("STAFF"));

  test.beforeAll(async () => {
    const sb = db!;
    const { data: card, error: cardErr } = await sb.from("rate_cards").select("id, version").eq("is_active", true).single();
    if (cardErr || !card) throw new Error(`no active rate card — run scripts/c1/seed.mjs (${cardErr?.message ?? "none"})`);
    const token = `revundo${Math.abs(Date.now() % 1e10)}${process.pid}xx`;
    const { data: est, error } = await sb.from("estimates").insert({
      title: "Revision undo e2e",
      status: "sent",
      sent_at: new Date().toISOString(),
      level_of_finish: 3,
      share_token: token,
      rate_card_id: card.id,
      rate_card_version: card.version,
      total_cents: 100000,
      builder_state: accepted,
      sent_snapshot: {
        version: 1,
        company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
        estRef: "EST-UNDO", contactName: "Undo Customer", contactEmail: "",
        totals: { totalCents: 100000 }, depositPct: 10,
        jobAddress: `28 Undo Test St ${process.pid}`, jobTitle: "Interior repaint", gstRatePct: 10,
        baseSubtotalCents: 90909, areas: [], lineItems: [], options: [], paints: [],
        inclusions: [], exclusions: [],
        proof: { rating: 4.9, reviews: 100, liability: "$20m", warrantyYears: 2 },
        terms: "",
      },
    }).select("id").single();
    if (error) throw new Error(`fixture estimate: ${error.message}`);
    estimateId = (est as { id: string }).id;
    const acc = await sb.rpc("accept_estimate", { p_token: token, p_name: "Undo E2E", p_options: [], p_total_cents: 0, p_deposit_cents: 0 });
    if (acc.error || acc.data !== "accepted") throw new Error(`accept: ${acc.error?.message ?? acc.data}`);
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

  test("Preparation hours on an untouched job are not a change", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    await expect(page.getByTestId("revision-badge")).toBeVisible();
    await expect(page.getByTestId("revision-no-changes")).toBeVisible();
    await expect(page.getByTestId("revision-change-adjustments")).toHaveCount(0);
  });

  test("undo one change: that section reverts, the other stays, and it sticks", async ({ page }) => {
    // Two changes in the working scope: the Pergola removed, a Garage added.
    const { error } = await db!.from("wo_working_scopes")
      .update({ working_state: { ...accepted, blocks: [lounge, garage] } })
      .eq("estimate_id", estimateId);
    if (error) throw new Error(`working scope: ${error.message}`);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}&mode=revision`);
    await expect(page.getByTestId("revision-change-block-2")).toContainText("Pergola — removed from scope");
    await expect(page.getByTestId("revision-change-block-3")).toContainText("Garage — added");

    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("revision-undo-block-2").click();
    await expect(page.getByTestId("revision-change-block-2")).toHaveCount(0);
    await expect(page.getByTestId("revision-change-block-3")).toBeVisible();
    await expect(page.getByText(/Saved ✓ \(working scope\)/)).toBeVisible();

    // Saved, not just on screen.
    const { data, error: readErr } = await db!.from("wo_working_scopes").select("working_state").eq("estimate_id", estimateId).single();
    if (readErr) throw new Error(readErr.message);
    const ids = ((data as { working_state: { blocks: { id: number }[] } }).working_state.blocks).map((b) => b.id);
    expect(ids).toEqual([1, 2, 3]);

    await page.reload();
    await expect(page.getByTestId("revision-change-block-2")).toHaveCount(0);
    await expect(page.getByTestId("revision-change-block-3")).toBeVisible();

    // Revise opens that area's folder in the builder.
    await page.getByTestId("revision-edit-block-3").click();
    await expect(page.getByText("Garage").first()).toBeVisible();

    // Cancel on the confirm changes nothing.
    page.once("dialog", (d) => void d.dismiss());
    await page.getByTestId("revision-undo-block-3").click();
    await expect(page.getByTestId("revision-change-block-3")).toBeVisible();
  });
});
