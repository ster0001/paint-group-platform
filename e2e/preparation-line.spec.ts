import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";
import { PREPARATION_DESCRIPTION } from "../lib/customer/snapshot";

/**
 * Tom, 15 Sep 2026 — 27 Allenby Avenue: "the costs don't add up".
 *
 * The per-job sundries allowance sat inside the subtotal but was never listed,
 * so the customer's visible items fell short of "Painting works as scoped" by
 * exactly that amount. Now it is the "Preparation" line: first in the builder
 * (amount editable, blank = the Settings default), first on the customer page,
 * and derived for every snapshot sent before the line existed.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");

const money = (cents: number) => "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseMoney = (s: string) => Math.round(Number(s.replace(/[^0-9.-]/g, "")) * 100);

const SNAPSHOT_BASE = {
  version: 1,
  company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: "Prep Customer", contactEmail: "", jobTitle: "Exterior repaint", gstRatePct: 10, depositPct: 10,
  lineItems: [], options: [], paints: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
};

async function customerParts(page: Page) {
  const rooms = page.locator("details.room");
  const names = await rooms.locator("summary .room-name").allTextContents();
  const prices = (await rooms.locator("summary .room-price").allTextContents()).map(parseMoney);
  const scoped = parseMoney(await page.locator(".trow", { hasText: "Painting works as scoped" }).locator(".v").textContent() ?? "");
  return { names, prices, scoped };
}

test.describe("the Preparation line", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let builtId = "";
  let builtToken = "";
  let legacyId = "";
  const legacyToken = `prep${run}legacy`;
  let interiorDefaultCents = 0;

  test.beforeAll(async () => {
    const { data: s } = await db!.from("settings").select("value").eq("key", "Sundries per job — interior").single();
    const v = (s?.value as { value?: number } | number | null);
    interiorDefaultCents = Math.round(((typeof v === "number" ? v : v?.value) ?? 0) * 100);
    expect(interiorDefaultCents, "the test project needs a non-zero interior sundries setting").toBeGreaterThan(0);

    builtToken = `prep${run}built`;
    const est = await db!.from("estimates").insert({
      title: `Preparation line ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: builtToken,
      builder_state: {
        blocks: [{ id: 1, kind: "area", name: "Living room", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4, isOption: false, description: "", open: false, media: [],
          surfaces: [{ id: 11, code: "WALL", coats: 2, count: 0, prepHr: 1, internalLabel: "Walls", clientLabel: "Walls" }] }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {},
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    builtId = est.data.id;

    // A snapshot from BEFORE the line existed: the $175 hides in the base subtotal.
    const legacy = await db!.from("estimates").insert({
      title: `Legacy snapshot ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: legacyToken,
      sent_at: new Date().toISOString(), total_cents: 110000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
      sent_snapshot: {
        ...SNAPSHOT_BASE, estRef: "EST-PREP", jobAddress: `27 Legacy Ave ${run}`,
        baseSubtotalCents: 100000,
        areas: [
          { id: "4", title: "Front", descriptionHtml: "", priceCents: 66952, surfaces: [{ label: "Fascias", coats: 2, product: "" }], photos: [] },
          { id: "8", title: "Left Side", descriptionHtml: "", priceCents: 15548, surfaces: [], photos: [] },
        ],
      },
    }).select("id").single();
    if (legacy.error) throw new Error(legacy.error.message);
    legacyId = legacy.data.id;
  });
  test.afterAll(async () => {
    for (const id of [builtId, legacyId]) if (id) await db!.from("estimates").delete().eq("id", id);
  });

  test("builder: shown first with the Settings default, editable, saved into the state and the snapshot", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/quote?id=${builtId}`);
    await page.waitForLoadState("networkidle");

    const card = page.getByTestId("preparation-line");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Preparation");
    await expect(card).toContainText(PREPARATION_DESCRIPTION);
    await expect(card).toContainText(`Settings default for this job (${money(interiorDefaultCents)})`);
    // It sits ABOVE the first area.
    const cardBox = await card.boundingBox();
    const areaBox = await page.getByText("Living room", { exact: true }).first().boundingBox();
    expect(cardBox!.y).toBeLessThan(areaBox!.y);

    // The right-hand Quote card: <Row> = <div class="flex"><dt>label</dt><dd>value</dd></div>.
    const rowValue = (label: string) => page.locator("dl div", { has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).first().locator("dd");
    const subtotalBefore = parseMoney(await rowValue("Subtotal").textContent() ?? "");
    expect(parseMoney(await rowValue("Preparation").textContent() ?? "")).toBe(interiorDefaultCents);

    const amount = page.getByTestId("preparation-amount");
    await expect(amount).toHaveAttribute("placeholder", String(interiorDefaultCents / 100));
    await amount.click();
    await amount.type("300");
    await expect(rowValue("Preparation")).toHaveText(money(30000));
    await expect(rowValue("Subtotal")).toHaveText(money(subtotalBefore - interiorDefaultCents + 30000));
    await expect(card).toContainText("Your figure");
    await page.screenshot({ path: test.info().outputPath("builder.png"), fullPage: false });

    await page.getByTestId("builder-save").click();
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("builder_state, sent_snapshot").eq("id", builtId).single();
      const bs = data?.builder_state as { preparationOverrideCents?: number } | null;
      return bs?.preparationOverrideCents ?? null;
    }, { timeout: 15_000 }).toBe(30000);
    const { data } = await db!.from("estimates").select("sent_snapshot").eq("id", builtId).single();
    const snap = data!.sent_snapshot as { baseSubtotalCents: number; preparation: { priceCents: number; title: string }; areas: { priceCents: number }[] };
    expect(snap.preparation.title).toBe("Preparation");
    expect(snap.preparation.priceCents).toBe(30000);
    expect(snap.areas.reduce((n, a) => n + a.priceCents, 0) + snap.preparation.priceCents).toBe(snap.baseSubtotalCents);

    // "Use default" clears the override and the Settings figure comes back.
    await page.getByTestId("preparation-reset").click();
    await expect(rowValue("Preparation")).toHaveText(money(interiorDefaultCents));
  });

  test("customer page: the built estimate lists Preparation first and the parts add to the subtotal", async ({ page }) => {
    await db!.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", builtId);
    await page.goto(`/e/${builtToken}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    const { names, prices, scoped } = await customerParts(page);
    expect(names[0]).toBe("Preparation");
    expect(prices[0]).toBe(30000);
    expect(prices.reduce((n, p) => n + p, 0)).toBe(scoped);
    await page.screenshot({ path: test.info().outputPath("customer.png"), fullPage: true });
    await page.locator("details.room").first().locator("summary").click();
    await expect(page.locator("details.room").first()).toContainText(PREPARATION_DESCRIPTION);
  });

  test("customer page: a snapshot sent before the line existed derives it, so old quotes add up too", async ({ page }) => {
    await page.goto(`/e/${legacyToken}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    const { names, prices, scoped } = await customerParts(page);
    expect(names).toEqual(["Preparation", "Front", "Left Side"]);
    expect(prices).toEqual([17500, 66952, 15548]);
    expect(scoped).toBe(100000);
  });
});
