import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom, 18 Sep 2026 — two things on the customer's estimate page.
 *
 * 1. Counted items show their count. "Doors" in the builder with a count of 4
 *    reads "Doors × 4" to the customer, per room, so they can see how many we
 *    counted. Measured surfaces (walls, ceilings) carry no count.
 * 2. Nine photos on the page; when there are more, a "More photos" button
 *    underneath opens the rest.
 *
 * Both are read as an ANONYMOUS customer on /e/[token]. The active C1 rate
 * card carries the production codes: "Walls" (m²) and "Flat Door (1 Side)"
 * (hours per item) on Interior.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");

const PX = (hex: string) => `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="%23${hex}"/></svg>`;

const surface = (id: number, code: string, label: string, count: number) => ({
  id, code, internalLabel: label, clientLabel: label, coats: 2, count,
  hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
  rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
  productName: null, color: "", colorHex: "",
  coverageOverride: null, volumeOverride: null, unitPriceOverride: null, crewNote: "",
  hideQty: false, showCoats: true, showPrice: false, useCustomRate: false,
  customRate: null, open: false,
});

const SNAPSHOT_BASE = {
  version: 1,
  company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: "Count Customer", contactEmail: "", jobTitle: "Interior repaint", gstRatePct: 10, depositPct: 10,
  lineItems: [], options: [], paints: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 100000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
};

type Snap = { areas: Array<{ surfaces: Array<{ label: string; count?: number }> }> };

test.describe("item counts on the customer's estimate", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const token = `cnt${run}${Date.now().toString(36)}abcdef`;
  let estimateId = "";

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Item counts ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: token,
      builder_state: {
        blocks: [{
          id: 1, kind: "area", name: "Living room", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4,
          isOption: false, description: "", open: false, media: [],
          surfaces: [surface(2, "Walls", "Walls", 1), surface(3, "Flat Door (1 Side)", "Doors", 4)],
        }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {}, materialColours: {}, colourMatches: {},
        contact: { first_name: "Count", last_name: "Customer", email: "", phone: "" },
        jobAddress: { address: "4 Count St", city: "Clayton", state: "VIC", postal: "3168" },
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
  });
  test.afterAll(async () => {
    if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
  });

  test("the builder writes the count into the snapshot and the customer reads it per room", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /estimates/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("builder-save").click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });

    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("sent_snapshot").eq("id", estimateId).single();
      const snap = data?.sent_snapshot as Snap | null;
      return snap?.areas[0]?.surfaces.map((s) => [s.label, s.count ?? null]) ?? null;
    }, { timeout: 20_000 }).toEqual([["Walls", null], ["Doors", 4]]);

    await db!.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", estimateId);

    // The customer: a fresh, signed-out browser.
    const anon = await browser.newContext();
    const cust = await anon.newPage();
    try {
      await cust.goto(`/e/${token}`);
      const room = cust.locator("details.room", { hasText: "Living room" });
      await expect(room).toBeVisible();
      const doors = room.locator(".surface", { hasText: "Doors" });
      await expect(doors.getByTestId("surface-count")).toHaveText("× 4");
      const walls = room.locator(".surface", { hasText: "Walls" });
      await expect(walls.getByTestId("surface-count")).toHaveCount(0);
    } finally {
      await anon.close();
    }
  });
});

test.describe("more than nine photos on the customer's estimate", () => {
  test.skip(!db, "set the C1 service key to run this");
  const token = `pho${run}${Date.now().toString(36)}abcdef`;
  let estimateId = "";
  const photos = ["c00", "0c0", "00c", "cc0", "c0c", "0cc", "888", "444", "f80", "08f", "80f", "f08"].map(PX);

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Twelve photos ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token,
      sent_at: new Date().toISOString(), total_cents: 110000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
      sent_snapshot: {
        ...SNAPSHOT_BASE, estRef: "EST-PHOTO", jobAddress: `12 Photo St ${run}`,
        areas: [
          { id: "1", title: "Lounge", descriptionHtml: "", priceCents: 60000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: photos.slice(0, 7) },
          { id: "2", title: "Hall", descriptionHtml: "", priceCents: 40000, surfaces: [{ label: "Doors", coats: 2, product: "", count: 3 }], photos: photos.slice(7) },
        ],
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
  });
  test.afterAll(async () => {
    if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
  });

  test("nine show, the button names the rest, pressing it shows them all", async ({ page }) => {
    await page.goto(`/e/${token}`);
    const grid = page.locator(".photos img.ph");
    await expect(grid).toHaveCount(9);
    const more = page.getByTestId("more-photos");
    await expect(more).toHaveText("More photos (3)");
    await expect(page.getByTestId("more-photos-list")).toHaveCount(0);

    await more.click();
    await expect(page.getByTestId("more-photos-list").locator("img.ph")).toHaveCount(3);
    await expect(page.locator("img.ph")).toHaveCount(12);
    await expect(page.locator("img.ph").nth(11)).toHaveAttribute("src", photos[11]);
    await expect(more).toHaveText("Fewer photos");

    // A count read from a snapshot (no builder involved) prints the same way.
    await expect(page.locator("details.room", { hasText: "Hall" }).getByTestId("surface-count")).toHaveText("× 3");
  });

  test("nine or fewer: no button", async ({ page }) => {
    await db!.from("estimates").update({ sent_snapshot: { ...SNAPSHOT_BASE, estRef: "EST-PHOTO", jobAddress: `12 Photo St ${run}`,
      areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 100000, surfaces: [], photos: photos.slice(0, 9) }] } }).eq("id", estimateId);
    await page.goto(`/e/${token}`);
    await expect(page.locator("img.ph")).toHaveCount(9);
    await expect(page.getByTestId("more-photos")).toHaveCount(0);
  });
});
