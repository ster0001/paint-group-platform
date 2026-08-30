import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Trade portal v2 · Session 2, commit A — THE golden test (Tom's ruling 1,
 * 30 Aug): two rooms, same product, different colours → BOTH colours survive
 * into (1) the saved work-order document's materials (what wo_snapshot
 * freezes on acceptance), (2) the job sheet the staff/painter sees, and
 * (3) work_orders.colours, keyed per colour. Driven AS STAFF against the
 * real builder — the compute under test is the builder's own.
 */

const db: SupabaseClient | null = serviceClient();
const staff = {
  email: process.env.E2E_STAFF_EMAIL ?? "",
  password: process.env.E2E_STAFF_PASSWORD ?? "",
};

const PRODUCT = "C1 Wall Paint"; // the C1 rate card's Interior WALL default

const surface = (id: number, colour: string, hex: string) => ({
  id, code: "WALL", internalLabel: "Walls", clientLabel: "Walls", coats: 2, count: 1,
  hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
  rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
  productName: PRODUCT, color: colour, colorHex: hex,
  coverageOverride: null, volumeOverride: null, unitPriceOverride: null, crewNote: "",
  hideQty: false, showCoats: true, showPrice: false, useCustomRate: false,
  customRate: null, open: false,
});
const area = (id: number, name: string, surfaceId: number, colour: string, hex: string) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4,
  isOption: false, description: "", open: false, media: [],
  surfaces: [surface(surfaceId, colour, hex)],
});

type WODocShape = {
  materials?: Array<{ product: string; colourKey?: string; colourName: string; colourStatus: string }>;
  areas?: Array<{ title: string; surfaces: Array<{ colourName?: string; colourKey?: string }> }>;
};

test.describe("colour split golden (trade portal v2, session 2A)", () => {
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  const run = randomBytes(4).toString("hex");
  let estimateId = "";
  let woId = "";

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Colour split golden ${run}`, status: "draft", source: "manual",
      builder_state: {
        blocks: [
          area(1, "Living room", 2, "Natural White", "#F1EDE4"),
          area(3, "Study", 4, "Domino", "#2A2E33"),
        ],
        modSel: {}, materials: {}, materialColours: {}, colourMatches: {},
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;
  });

  test.afterAll(async () => {
    if (woId) await db!.from("work_orders").delete().eq("id", woId);
    if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
  });

  test("both colours survive the builder save, the job sheet, and work_orders.colours", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/login");
    await page.fill('input[type="email"]', staff.email);
    await page.fill('input[type="password"]', staff.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/estimates/);

    // 1 · The real builder computes the doc; Save persists builder_state.woDoc.
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /^save/i }).first().click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });

    let doc: WODocShape = {};
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("builder_state").eq("id", estimateId).single();
      doc = ((data?.builder_state as { woDoc?: WODocShape } | null)?.woDoc) ?? {};
      return (doc.materials ?? []).length;
    }, { timeout: 20_000 }).toBe(2);

    const colours = (doc.materials ?? []).map((m) => m.colourName).sort();
    expect(colours).toEqual(["Domino", "Natural White"]);
    expect((doc.materials ?? []).map((m) => m.colourKey).sort()).toEqual([
      `${PRODUCT}||Domino`, `${PRODUCT}||Natural White`,
    ]);
    // Per-surface truth rides the areas too — the write path's grouping input.
    const living = doc.areas?.find((a) => a.title === "Living room");
    const study = doc.areas?.find((a) => a.title === "Study");
    expect(living?.surfaces[0]?.colourName).toBe("Natural White");
    expect(study?.surfaces[0]?.colourKey).toBe(`${PRODUCT}||Domino`);

    // 2 · A work order over that document (what acceptance creates).
    const wo = await db!.from("work_orders").insert({
      estimate_id: estimateId, wo_ref: `WO-GOLD${run}`.slice(0, 12),
      share_token: `gold${run}${Date.now()}`, status: "issued", stage: "pre_start",
      issued_at: new Date().toISOString(), wo_snapshot: doc, colours: {},
    }).select("id").single();
    if (wo.error) throw new Error(wo.error.message);
    woId = wo.data.id;

    // 3 · The job sheet (work-order tab) shows BOTH colours, each with its
    // own confirm chip; confirming Domino writes the per-colour key.
    await page.goto(`/quote?id=${estimateId}&view=workorder`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Natural White").first()).toBeVisible();
    await expect(page.getByText("Domino").first()).toBeVisible();

    const dominoRow = page.locator(".mat", { hasText: "Domino" });
    await dominoRow.getByRole("button", { name: /^TBC$/i }).click();
    await expect(dominoRow.getByRole("button", { name: /confirmed/i })).toBeVisible();

    await expect.poll(async () => {
      const { data } = await db!.from("work_orders").select("colours").eq("id", woId).single();
      const c = (data?.colours ?? {}) as Record<string, { status?: string }>;
      return c[`${PRODUCT}||Domino`]?.status ?? "absent";
    }, { timeout: 20_000 }).toBe("confirmed");

    // Natural White stays untouched — its own key, its own status.
    const { data: after } = await db!.from("work_orders").select("colours").eq("id", woId).single();
    const map = (after?.colours ?? {}) as Record<string, { status?: string }>;
    expect(map[`${PRODUCT}||Natural White`]).toBeUndefined();
  });
});
