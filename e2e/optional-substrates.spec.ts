import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 16 Sep 2026 — one substrate of a room offered as an option.
 *
 * The check as Tom described it: open a room in the builder, see its
 * substrates, press ONE button on the doors row and the doors become an
 * option: they leave the room's price and the total, and show under
 * "Optional extras" as "Living room — Doors" with their own price. On the
 * customer's page the option is there to tick; ticking it lifts the total by
 * exactly that price. Nothing else about the room changes.
 *
 * The active C1 rate card (v7) carries the production codes: "Walls" (m²)
 * and "Flat Door (1 Side)" (hours per item) on Interior.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(4).toString("hex");
const money = (cents: number) => "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseMoney = (s: string) => Math.round(Number(s.replace(/[^0-9.-]/g, "")) * 100);

const AREA_ID = 1;
const WALL_ID = 2;
const DOOR_ID = 3;

const surface = (id: number, code: string, label: string, count: number) => ({
  id, code, internalLabel: label, clientLabel: label, coats: 2, count,
  hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
  rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
  productName: null, color: "", colorHex: "",
  coverageOverride: null, volumeOverride: null, unitPriceOverride: null, crewNote: "",
  hideQty: false, showCoats: true, showPrice: false, useCustomRate: false,
  customRate: null, open: false,
});

type Snap = {
  baseSubtotalCents: number;
  preparation: { priceCents: number } | null;
  areas: Array<{ id: string; priceCents: number; surfaces: Array<{ label: string }> }>;
  options: Array<{ id: string; title: string; priceCents: number; descriptionHtml: string }>;
};
type WODocShape = {
  contractorPaymentCents?: number;
  appliedOptions?: string[];
  areas?: Array<{ title: string; surfaces: Array<{ key: string; label?: string; code?: string }> }>;
  materials?: Array<{ product: string; litres: number | null }>;
};
type State = {
  blocks: Array<{ id: number; surfaces: Array<{ id: number; isOption?: boolean }> }>;
  woDoc?: WODocShape;
  woOptions?: Record<string, { title: string; contractorPaymentCents: number; areas: Array<{ surfaces: Array<{ label: string }> }> }>;
};

async function openBuilder(page: Page, estimateId: string) {
  await page.goto(`/quote?id=${estimateId}`);
  await page.waitForLoadState("networkidle");
}

test.describe("optional substrates in a room", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const token = `opt${run}${Date.now().toString(36)}abcdef`;
  let estimateId = "";
  let doorCents = 0;

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Optional substrates ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: token,
      builder_state: {
        blocks: [{
          id: AREA_ID, kind: "area", name: "Living room", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4,
          isOption: false, description: "<p>The living room</p>", open: false, media: [],
          surfaces: [surface(WALL_ID, "Walls", "Walls", 1), surface(DOOR_ID, "Flat Door (1 Side)", "Doors", 2)],
        }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {}, materialColours: {}, colourMatches: {},
        contact: { first_name: "Opt", last_name: "Customer", email: "", phone: "" },
        jobAddress: { address: "1 Option St", city: "Clayton", state: "VIC", postal: "3168" },
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
  });

  test.afterAll(async () => {
    if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
  });

  test("builder: one press makes the doors an option — out of the room's price, into Optional extras, saved", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, staff!, /estimates/);
    await openBuilder(page, estimateId);

    // Into the room. The row of substrates is the breakdown Tom asked for.
    await page.getByText("Living room", { exact: true }).first().click();
    const doorRow = page.getByTestId(`surface-row-${DOOR_ID}`);
    await expect(doorRow).toBeVisible();
    await expect(doorRow).toHaveAttribute("data-option", "false");
    const roomBefore = parseMoney(await page.getByTestId("area-price").textContent() ?? "");
    const doorRowTotal = parseMoney(await doorRow.locator("td").nth(7).textContent() ?? "");
    expect(doorRowTotal).toBeGreaterThan(0);

    // ONE button.
    await page.getByTestId(`surface-option-toggle-${DOOR_ID}`).click();
    await expect(doorRow).toHaveAttribute("data-option", "true");
    await expect(doorRow).toContainText("Optional");
    await expect(page.getByTestId("area-price")).toHaveText(money(roomBefore - doorRowTotal));
    await expect(page.getByTestId("area-optional-price")).toContainText(money(doorRowTotal));
    await expect(page.getByTestId("area-optional-row")).toContainText(money(doorRowTotal).replace("$", ""));
    doorCents = doorRowTotal;

    // Back on the list: the room's card says what is optional, and the
    // option has its own card under Optional extras.
    await page.getByRole("button", { name: "← All areas" }).click();
    await expect(page.getByTestId(`area-optional-${AREA_ID}`)).toContainText(`+ ${money(doorCents)} optional`);
    const card = page.getByTestId(`surface-option-${AREA_ID}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Living room — Doors");
    await expect(card).toContainText(money(doorCents));

    // Saved: the flag on the surface, the option in the customer snapshot,
    // and the doors OFF the work-order document.
    await page.getByTestId("builder-save").click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
    let state: State | null = null;
    let snap: Snap | null = null;
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("builder_state, sent_snapshot").eq("id", estimateId).single();
      state = (data?.builder_state as State | null) ?? null;
      snap = (data?.sent_snapshot as Snap | null) ?? null;
      return state?.blocks?.[0]?.surfaces?.find((s) => s.id === DOOR_ID)?.isOption ?? null;
    }, { timeout: 20_000 }).toBe(true);
    expect(state!.blocks[0].surfaces.find((s) => s.id === WALL_ID)?.isOption ?? false).toBe(false);

    const area = snap!.areas.find((a) => a.id === String(AREA_ID))!;
    expect(area.surfaces.map((s) => s.label)).toEqual(["Walls"]);
    expect(area.priceCents).toBe(roomBefore - doorCents);
    expect(snap!.options).toHaveLength(1);
    expect(snap!.options[0].id).toBe(`${AREA_ID}:surfaces`);
    expect(snap!.options[0].title).toBe("Living room — Doors");
    expect(snap!.options[0].priceCents).toBe(doorCents);
    expect(snap!.options[0].descriptionHtml).toContain("Doors");
    // The base subtotal is the included parts only.
    expect(snap!.baseSubtotalCents).toBe(area.priceCents + (snap!.preparation?.priceCents ?? 0));
    // And the painter's sheet does not carry the doors until they are bought.
    const woArea = state!.woDoc?.areas?.find((a) => a.title === "Living room");
    expect(woArea?.surfaces.map((s) => s.label ?? s.code)).toEqual(["Walls"]);
  });

  test("customer page: the option is there to tick, and ticking it lifts the total by its price", async ({ page }) => {
    test.skip(!doorCents, "the builder test did not run");
    await db!.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", estimateId);
    await page.goto(`/e/${token}`);
    await expect(page.locator("details.room").first()).toBeVisible();

    // The room lists only what is included.
    const room = page.locator("details.room", { hasText: "Living room" }).first();
    await expect(room).toContainText("Walls");
    await expect(room).not.toContainText("Doors");

    const option = page.locator(".option", { hasText: "Living room — Doors" });
    await expect(option).toBeVisible();
    await expect(option).toContainText(`+ ${money(doorCents)}`);

    const totalRow = page.locator(".trow.total .v");
    const before = parseMoney(await totalRow.textContent() ?? "");
    await option.locator(".option-toggle").click();
    // + the option, + GST on it.
    await expect(totalRow).toHaveText(money(before + Math.round(doorCents * 1.1)));
    await expect(page.locator(".trow", { hasText: "Living room — Doors" }).locator(".v")).toHaveText(money(doorCents));

    // Untick: back where it was.
    await option.locator(".option-toggle").click();
    await expect(totalRow).toHaveText(money(before));
  });

  test("builder: 'Put back in the estimate' returns the doors to the room in one press", async ({ page }) => {
    test.skip(!doorCents, "the builder test did not run");
    await db!.from("estimates").update({ status: "draft", sent_at: null }).eq("id", estimateId);
    await signIn(page, staff!, /estimates/);
    await openBuilder(page, estimateId);
    const card = page.getByTestId(`surface-option-${AREA_ID}`);
    await expect(card).toBeVisible();
    await page.getByTestId(`surface-option-include-${AREA_ID}`).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("optional-extras")).toHaveCount(0);
    await expect(page.getByTestId(`area-optional-${AREA_ID}`)).toHaveCount(0);
  });

  /**
   * Tom, 16 Sep (second ruling): what the customer ticks reaches the work
   * order. Migration 20270149: the builder saves a job-sheet fragment per
   * option; acceptance merges the ticked ones into the work order's document,
   * its pay and the painter's tick list.
   */
  test("acceptance: a ticked option is on the work order, its pay and the tick list", async ({ page }) => {
    test.skip(!doorCents, "the builder test did not run");
    test.setTimeout(180_000);
    await signIn(page, staff!, /estimates/);
    await openBuilder(page, estimateId);
    await page.getByText("Living room", { exact: true }).first().click();
    // The put-back above was never saved, so the doors are still optional on
    // disk; press only if a row reads Included.
    const doorRow = page.getByTestId(`surface-row-${DOOR_ID}`);
    await expect(doorRow).toBeVisible();
    if ((await doorRow.getAttribute("data-option")) !== "true") {
      await page.getByTestId(`surface-option-toggle-${DOOR_ID}`).click();
    }
    await expect(doorRow).toHaveAttribute("data-option", "true");
    await page.getByRole("button", { name: "← All areas" }).click();
    await page.getByTestId("builder-save").click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });

    let state: State | null = null;
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("builder_state").eq("id", estimateId).single();
      state = (data?.builder_state as State | null) ?? null;
      return state?.woOptions?.[`${AREA_ID}:surfaces`]?.title ?? null;
    }, { timeout: 20_000 }).toBe("Living room — Doors");
    const fragment = state!.woOptions![`${AREA_ID}:surfaces`];
    expect(fragment.areas[0].surfaces.map((s) => s.label)).toEqual(["Doors"]);
    expect(fragment.contractorPaymentCents).toBeGreaterThan(0);
    const basePay = state!.woDoc!.contractorPaymentCents!;
    expect(state!.woDoc!.areas![0].surfaces.map((s) => s.label)).toEqual(["Walls"]);

    await db!.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", estimateId);
    const accepted = await db!.rpc("accept_estimate", {
      p_token: token, p_name: "Opt Customer", p_options: [`${AREA_ID}:surfaces`], p_total_cents: 0, p_deposit_cents: 0,
    });
    expect(accepted.error).toBeNull();
    expect(accepted.data).toBe("accepted");

    const { data: wo } = await db!.from("work_orders").select("id, wo_snapshot, contractor_payment_cents").eq("estimate_id", estimateId).single();
    const snap = wo!.wo_snapshot as WODocShape;
    expect(snap.appliedOptions).toEqual([`${AREA_ID}:surfaces`]);
    const living = snap.areas!.find((a) => a.title === "Living room")!;
    expect(living.surfaces.map((s) => s.label)).toEqual(["Walls", "Doors"]);
    expect(snap.contractorPaymentCents).toBe(basePay + fragment.contractorPaymentCents);
    expect(wo!.contractor_payment_cents).toBe(basePay + fragment.contractorPaymentCents);
    // The estimate's own document too, so a later Issue keeps the doors.
    const { data: after } = await db!.from("estimates").select("builder_state").eq("id", estimateId).single();
    const doc = (after!.builder_state as State).woDoc!;
    expect(doc.areas![0].surfaces.map((s) => s.label)).toEqual(["Walls", "Doors"]);
    expect(doc.appliedOptions).toEqual([`${AREA_ID}:surfaces`]);
    // And the painter's tick list has a Doors row.
    const { data: rows } = await db!.from("wo_surfaces").select("label, heading, surface_key").eq("work_order_id", wo!.id).order("sort");
    expect(rows!.map((r) => r.label)).toContain("Doors");
    expect(rows!.find((r) => r.label === "Doors")!.surface_key).toBe(`${AREA_ID}:${DOOR_ID}`);
  });

  test("after acceptance: staff add an option the customer asked for since — total, invoice and work order follow", async ({ page }) => {
    test.skip(!doorCents, "the builder test did not run");
    test.setTimeout(180_000);
    // A second estimate, accepted WITHOUT the doors.
    const token2 = `${token}b`;
    const est = await db!.from("estimates").insert({
      title: `Optional substrates B ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: token2,
      builder_state: {
        blocks: [{
          id: AREA_ID, kind: "area", name: "Living room", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4,
          isOption: false, description: "<p>The living room</p>", open: false, media: [],
          surfaces: [surface(WALL_ID, "Walls", "Walls", 1), { ...surface(DOOR_ID, "Flat Door (1 Side)", "Doors", 2), isOption: true }],
        }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {}, materialColours: {}, colourMatches: {},
        contact: { first_name: "Opt", last_name: "Customer", email: "", phone: "" },
        jobAddress: { address: "2 Option St", city: "Clayton", state: "VIC", postal: "3168" },
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    const id2 = est.data.id as string;
    try {
      await signIn(page, staff!, /estimates/);
      await openBuilder(page, id2);
      await page.getByTestId("builder-save").click();
      await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => {
        const { data } = await db!.from("estimates").select("builder_state").eq("id", id2).single();
        return (data?.builder_state as State | null)?.woOptions?.[`${AREA_ID}:surfaces`]?.title ?? null;
      }, { timeout: 20_000 }).toBe("Living room — Doors");

      await db!.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", id2);
      const accepted = await db!.rpc("accept_estimate", { p_token: token2, p_name: "Opt Customer", p_options: [], p_total_cents: 0, p_deposit_cents: 0 });
      expect(accepted.data).toBe("accepted");
      const { data: before } = await db!.from("estimates").select("accepted_total_cents, sent_snapshot").eq("id", id2).single();
      const optPrice = (before!.sent_snapshot as Snap).options[0].priceCents;
      expect(optPrice).toBe(doorCents);

      // The accepted job in the builder: the option is listed, not on the job.
      await openBuilder(page, id2);
      const row = page.getByTestId(`accepted-option-${AREA_ID}:surfaces`);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("data-selected", "false");
      await page.getByTestId(`accepted-option-add-${AREA_ID}:surfaces`).click();
      await expect(page.getByTestId("accepted-options-msg")).toContainText("on the work order", { timeout: 20_000 });
      await expect(row).toHaveAttribute("data-selected", "true");

      const { data: after } = await db!.from("estimates").select("selected_options, accepted_total_cents, total_cents").eq("id", id2).single();
      expect(after!.selected_options).toEqual([`${AREA_ID}:surfaces`]);
      expect(after!.accepted_total_cents).toBe(before!.accepted_total_cents + Math.round(optPrice * 1.1));
      const { data: wo } = await db!.from("work_orders").select("id, wo_snapshot").eq("estimate_id", id2).single();
      const snap = wo!.wo_snapshot as WODocShape;
      expect(snap.appliedOptions).toEqual([`${AREA_ID}:surfaces`]);
      expect(snap.areas!.find((a) => a.title === "Living room")!.surfaces.map((s) => s.label)).toEqual(["Walls", "Doors"]);
      const { data: rows } = await db!.from("wo_surfaces").select("label").eq("work_order_id", wo!.id);
      expect(rows!.map((r) => r.label)).toContain("Doors");
      // Pressing again changes nothing.
      const again = await db!.rpc("wo_apply_selected_options", { p_estimate_id: id2 });
      expect(again.data).toBe("ok:nothing");
    } finally {
      await db!.from("estimates").delete().eq("id", id2);
    }
  });
});
