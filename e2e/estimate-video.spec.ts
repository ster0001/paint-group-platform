import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn, test } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Videos on the estimate (Tom, 19 Oct 2026: "make sure vids can be added in
 * the estimate" — customers send walk-round clips on WhatsApp and the office
 * wants them beside the photos).
 *
 * The estimate's media is a list of PUBLIC URLs frozen into the snapshot; a
 * video rides the same list and is told apart by its extension
 * (lib/media/video.ts), so there is no new field anywhere. Three places have
 * to agree, and this spec reads each one:
 *   1. the builder takes an MP4 into an area's Room photos and the saved
 *      snapshot carries its URL (the estimate-media bucket must admit video —
 *      20270276 — or the upload dies at storage with a 400);
 *   2. the customer's own page, read with NO session, draws a <video> tile in
 *      "Your property, as we saw it", not a broken <img>;
 *   3. the painter's job sheet, read by its token with NO session, draws the
 *      same clip as a play-badge tile under its area that the lightbox plays.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const run = randomBytes(3).toString("hex");

// A minimal MP4 — an `ftyp` box with the isom brand. Not playable, but a real
// object in the bucket with a video extension, which is all a tile needs.
const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 8, 0x6d, 0x64, 0x61, 0x74]);
const PX = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="%23c00"/></svg>`;

const surface = (id: number, code: string, label: string) => ({
  id, code, internalLabel: label, clientLabel: label, coats: 2, count: 1,
  hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
  rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
  productName: null, color: "", colorHex: "",
  coverageOverride: null, volumeOverride: null, unitPriceOverride: null, crewNote: "",
  hideQty: false, showCoats: true, showPrice: false, useCustomRate: false,
  customRate: null, open: false,
});

type Snap = { areas: Array<{ title: string; photos: string[] }> };

test.describe("a video in the estimate's area media", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const token = `vid${run}${Date.now().toString(36)}abcdef`;
  let estimateId = "";
  let uploadedPath = "";

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Estimate video ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: token,
      builder_state: {
        blocks: [{
          id: 1, kind: "area", name: "Living room", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4,
          isOption: false, description: "", open: true, media: [{ path: "px", url: PX }],
          surfaces: [surface(2, "Walls", "Walls")],
        }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {}, materialColours: {}, colourMatches: {},
        contact: { first_name: "Video", last_name: "Customer", email: "", phone: "" },
        jobAddress: { address: "9 Clip St", city: "Clayton", state: "VIC", postal: "3168" },
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
  });
  test.afterAll(async () => {
    // Anything an e2e run creates, an e2e run removes — the clip in the public bucket too.
    if (uploadedPath) await db!.storage.from("estimate-media").remove([uploadedPath]);
    if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
  });

  test("the builder takes an MP4, the snapshot carries it, the customer sees a video tile", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");

    // Into the room: the builder lists areas, and the Room photos box is in
    // the area's own editor. Its input is the first media input on the page.
    await page.getByText("Living room", { exact: true }).first().click();
    const input = page.getByTestId("estimate-media-input").first();
    await expect(input).toBeAttached({ timeout: 20_000 });
    await input.setInputFiles({ name: "WhatsApp Video 2026-10-19.mp4", mimeType: "video/mp4", buffer: MP4 });
    const clip = page.locator('[data-testid="estimate-media-item"][data-media="video"]');
    await expect(clip).toHaveCount(1, { timeout: 30_000 });
    await expect(clip.locator("video")).toHaveCount(1);
    // The photo that was already there is still a photo.
    await expect(page.locator('[data-testid="estimate-media-item"][data-media="image"]')).toHaveCount(1);

    await page.getByRole("button", { name: "← All areas" }).click();
    await page.getByTestId("builder-save").click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });

    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("sent_snapshot").eq("id", estimateId).single();
      const snap = data?.sent_snapshot as Snap | null;
      return snap?.areas[0]?.photos.map((u) => u.split(".").pop()) ?? null;
    }, { timeout: 20_000 }).toEqual([expect.any(String), "mp4"]);
    const { data } = await db!.from("estimates").select("sent_snapshot").eq("id", estimateId).single();
    const videoUrl = (data?.sent_snapshot as Snap).areas[0].photos.find((u) => u.endsWith(".mp4"))!;
    uploadedPath = videoUrl.split("/estimate-media/")[1] ?? "";
    expect(uploadedPath).toMatch(/\.mp4$/);

    await db!.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", estimateId);

    // The customer: a fresh, signed-out browser.
    const anon = await browser.newContext();
    const cust = await anon.newPage();
    try {
      await cust.goto(`/e/${token}`);
      const grid = cust.locator(".photos");
      await expect(grid.first()).toBeVisible();
      await expect(cust.getByTestId("estimate-video")).toHaveCount(1);
      await expect(cust.locator(".photos img.ph")).toHaveCount(1);
      await expect(cust.getByText(/Photos and videos from your enquiry/)).toBeVisible();
    } finally {
      await anon.close();
    }
  });
});

test.describe("the same clip on the painter's job sheet", () => {
  test.skip(!db || !contractor, missingCreds("CONTRACTOR"));
  let fixture: LoopFixture | null = null;
  let shareToken = "";
  const clipPath = `e2e-video/${run}.mp4`;
  let clipUrl = "";

  test.beforeAll(async () => {
    const up = await db!.storage.from("estimate-media").upload(clipPath, MP4, { contentType: "video/mp4", upsert: true });
    if (up.error) throw new Error(`fixture clip: ${up.error.message}`);
    clipUrl = db!.storage.from("estimate-media").getPublicUrl(clipPath).data.publicUrl;

    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    const { data, error } = await db!.from("work_orders")
      .select("share_token, wo_snapshot").eq("id", fixture.workOrderId).single();
    if (error) throw new Error(`fixture: ${error.message}`);
    shareToken = (data as { share_token: string }).share_token;
    // The scope photos frozen into the sheet, as the builder would have frozen them: one photo, one clip.
    const snap = (data as { wo_snapshot: { areas: Array<{ photos: string[] }> } }).wo_snapshot;
    snap.areas[0].photos = [PX, clipUrl];
    const { error: upErr } = await db!.from("work_orders").update({ wo_snapshot: snap }).eq("id", fixture.workOrderId);
    if (upErr) throw new Error(`fixture snapshot: ${upErr.message}`);
  });
  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
    await db!.storage.from("estimate-media").remove([clipPath]);
  });

  test("the sheet, read by token with no session, shows a play tile that the lightbox plays", async ({ page }) => {
    await page.goto(`/w/${shareToken}`);
    const tiles = page.getByTestId("area-photo");
    await expect(tiles).toHaveCount(2);
    const clip = page.locator('[data-testid="area-photo"][data-media="video"]');
    await expect(clip).toHaveCount(1);
    await expect(clip.locator("video")).toHaveCount(1);
    await clip.click();
    await expect(page.getByTestId("lightbox-video")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("lightbox-video")).toHaveCount(0);
  });
});
