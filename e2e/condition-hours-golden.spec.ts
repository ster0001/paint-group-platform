import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom, 3 Sep 2026: "when an estimate is marked as needing extra prep (poor
 * condition) more hours need to be added for the contractor."
 *
 * The REAL builder computes the work-order document; a job priced at
 * Condition = Poor must land on the painter's sheet with the condition named
 * and the extra hours split out — not just a bigger number.
 */
const db = serviceClient();
const staff = credentials("STAFF");

const surface = (id: number) => ({
  id, code: "Walls", internalLabel: "Walls", clientLabel: "Walls", coats: 2, count: 1,
  hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
  rateOverride: null, paintingHrOverride: null, prepHr: 0.5, priceOverride: null,
  productName: null, color: "", colorHex: "",
  coverageOverride: null, volumeOverride: null, unitPriceOverride: null, crewNote: "",
  hideQty: false, showCoats: true, showPrice: false, useCustomRate: false,
  customRate: null, open: false,
});
const area = (id: number, name: string, surfaceId: number) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4,
  isOption: false, description: "", open: false, media: [], surfaces: [surface(surfaceId)],
});

type Doc = {
  condition?: { code: string; label: string; multiplier: number; extraHours: number } | null;
  areas?: Array<{ surfaces: Array<{ hours: number | null; paintingHours?: number; prepHours?: number; conditionHours?: number }> }>;
};

test.describe("condition → the painter's hours (golden)", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const run = randomBytes(4).toString("hex");
  let estimateId = "";

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Condition golden ${run}`, status: "draft", source: "manual",
      builder_state: {
        blocks: [area(1, "Living room", 2)],
        modSel: { "Level of Finish": "FIN-3", Condition: "COND-POOR" },
        materials: {}, materialColours: {}, colourMatches: {},
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;
  });
  test.afterAll(async () => { if (estimateId) await db!.from("estimates").delete().eq("id", estimateId); });

  test("a Poor job's work order names the condition and the extra hours", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /^save/i }).first().click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });

    let doc: Doc = {};
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("builder_state").eq("id", estimateId).single();
      doc = ((data?.builder_state as { woDoc?: Doc } | null)?.woDoc) ?? {};
      return doc.condition?.code ?? "";
    }, { timeout: 20_000 }).toBe("COND-POOR");

    expect(doc.condition!.multiplier).toBe(1.35);
    expect(doc.condition!.extraHours).toBeGreaterThan(0);
    const s = doc.areas![0].surfaces[0];
    expect(s.conditionHours!).toBeGreaterThan(0);
    expect(s.prepHours).toBe(0.5);
    // hours = painting (already ×1.35) + prep; the condition slice is inside painting.
    expect(Math.abs((s.hours ?? 0) - ((s.paintingHours ?? 0) + (s.prepHours ?? 0)))).toBeLessThan(0.02);
    expect(Math.abs(doc.condition!.extraHours - s.conditionHours!)).toBeLessThan(0.02);

    // The job sheet says it in words.
    await page.goto(`/quote?id=${estimateId}&view=workorder`);
    await page.waitForLoadState("networkidle");
    const cond = page.getByTestId("wo-condition");
    await expect(cond).toBeVisible();
    await expect(cond).toContainText("Poor");
    await expect(cond).toContainText(`+${doc.condition!.extraHours.toFixed(1)} h`);
    await expect(page.getByTestId("surf-prep-1:2")).toContainText("h prep");
    await page.screenshot({ path: "/tmp/look-wo-condition.png" });
  });
});
