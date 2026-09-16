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
type State = {
  blocks: Array<{ id: number; surfaces: Array<{ id: number; isOption?: boolean }> }>;
  woDoc?: { areas?: Array<{ title: string; surfaces: Array<{ label?: string; code?: string }> }> };
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
});
