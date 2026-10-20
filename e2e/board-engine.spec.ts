import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Movements Session 2 (docs/briefs/movements-build-plan.md): the Schedule
 * board's drag now runs on the shared engine in app/components/board. The
 * rule for that session is NO behaviour change, so this spec pins what the
 * engine must keep doing on the Schedule board, from the user's side:
 *
 *   1. a drag from the tray onto a lane still opens the confirm step, with
 *      the ghost naming the day under the pointer and the sheet opening on
 *      the same dates;
 *   2. a drop on a BLOCKED span is still called out — the lane turns red
 *      under the pointer, the ghost says so, and the sheet carries the
 *      warning — and a release that is not over a lane opens nothing;
 *   3. the same drag works at a touch viewport (one-column layout).
 *
 * One tray job and one block-out, created here and removed after. Nothing is
 * sent — every sheet is cancelled.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const run = Date.now().toString(36);
const TITLE = `Board Engine ${run}`;
let estimateId = "";
let workOrderId = "";
let unavailabilityId = "";

async function centre(page: Page, selector: string) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Several small moves: one jump can be read as a click rather than a drag. */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
}

/** A midweek cell on the lane, ≥ 2 columns in, so the snapped start IS the cell whatever the painter's weekend flags say. */
async function midweekCell(lane: ReturnType<Page["locator"]>, skip = 2) {
  const cells = lane.locator(".bgc");
  const n = await cells.count();
  for (let i = skip; i < Math.min(n, 24); i++) {
    const d = (await cells.nth(i).getAttribute("data-day")) ?? "";
    const dow = new Date(d + "T00:00:00Z").getUTCDay();
    if (dow >= 2 && dow <= 4) return { idx: i, day: d, cell: cells.nth(i) };
  }
  throw new Error("no midweek cell on the lane");
}

async function openBoard(page: Page) {
  await signIn(page, staff!, /\/(home|estimates)/);
  await page.goto("/pc/schedule");
  await expect(page.getByTestId("lane").first()).toBeVisible({ timeout: 30_000 });
  // The tray is longest-wait first, so a job accepted just now sits at the
  // bottom — narrow the tray to it so it has a box to drag from.
  await page.getByTestId("tray-search").fill(TITLE);
  const card = page.getByTestId("tray-job").filter({ hasText: TITLE });
  await expect(card).toHaveCount(1);
  return card;
}

test.describe("board engine: the Schedule board drags as before", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the tray job");

  test.beforeAll(async () => {
    const { data: est, error: estErr } = await db!.from("estimates")
      .insert({ status: "accepted", source: "manual", level_of_finish: 3, title: TITLE, accepted_at: new Date().toISOString() })
      .select("id").single();
    if (estErr) throw new Error(`estimate: ${estErr.message}`);
    estimateId = (est as { id: string }).id;
    const woRef = `WO-E2EB${run.slice(-4)}`;
    const { data: wo, error: woErr } = await db!.from("work_orders").insert({
      estimate_id: estimateId, wo_ref: woRef,
      share_token: `${run}be${"x".repeat(24)}`.slice(0, 32),
      stage: "pre_start", status: "issued", issued_at: new Date().toISOString(),
      wo_snapshot: {
        version: 1, woRef, status: "issued", jobTitle: TITLE,
        jobAddress: "1 Test St, Brunswick, VIC, 3000",
        contactFirstName: "Test", contactPhone: "", startDate: null,
        accessNotes: "", crewNotes: "", levelOfFinish: "Level 3", finishCode: "PG-3",
        contractorName: "", contractorPaymentCents: 0, materials: [], areas: [],
        exclusions: [], company: { name: "Paint Group", phone: "", logoUrl: "" },
      },
    }).select("id").single();
    if (woErr) throw new Error(`work order: ${woErr.message}`);
    workOrderId = (wo as { id: string }).id;
  });

  test.afterAll(async () => {
    if (!db) return;
    if (unavailabilityId) await db.from("contractor_unavailability").delete().eq("id", unavailabilityId);
    if (workOrderId) await db.from("work_orders").delete().eq("id", workOrderId);
    if (estimateId) await db.from("estimates").delete().eq("id", estimateId);
  });

  test.describe("desktop", () => {
    test.use({ viewport: { width: 1400, height: 900 } });

    test("a drag onto a lane opens the confirm step on the day the ghost named", async ({ page }) => {
      test.setTimeout(120_000);
      const card = await openBoard(page);
      const lane = page.getByTestId("lane").first();
      const target = await midweekCell(lane);
      const to = await centre(page, `[data-testid="lane"] >> nth=0 >> .bgc >> nth=${target.idx}`);
      const from = await centre(page, `[data-testid="tray-job"]:has-text("${TITLE}")`);

      await dragTo(page, from, to);
      const ghost = page.getByTestId("ghost-dates");
      await expect(ghost).toBeVisible();
      expect(await ghost.getAttribute("data-start")).toBe(target.day);
      await expect(target.cell).toHaveClass(/hot/);
      // The hot cell is the one under the pointer, and it sits under its own header date.
      await expect(lane.locator(".bgc.hot")).toHaveCount(1);
      const hdr = await page.locator(".sb .dh .cell").nth(target.idx + 1).boundingBox();
      const hot = await target.cell.boundingBox();
      expect(Math.abs((hdr?.x ?? 0) - (hot?.x ?? 1e9))).toBeLessThan(2);
      await page.mouse.up();

      // The confirm step, on the ghost's dates.
      const dates = page.getByTestId("booking-dates");
      await expect(dates).toBeVisible();
      expect(await dates.getAttribute("data-start")).toBe(target.day);
      await expect(page.getByTestId("drop-confirm")).toBeVisible();
      await expect(page.locator(".sheet.open")).toHaveCount(1);
      await page.locator(".sheet.open").getByRole("button", { name: "Cancel" }).click();
      await expect(dates).toHaveCount(0);
      // The job is still in the tray — nothing was sent.
      await expect(card).toHaveCount(1);
    });

    test("a blocked span is called out under the pointer and on the sheet; a release off the lanes opens nothing", async ({ page }) => {
      test.setTimeout(150_000);
      let card = await openBoard(page);
      const lane = page.getByTestId("lane").first();
      const contractorId = (await lane.getAttribute("data-contractor-id")) ?? "";
      expect(contractorId).not.toBe("");
      // Block the first lane's painter out on a midweek day, then come back
      // to the board so the block is drawn.
      const target = await midweekCell(lane, 4);
      const { data: blk, error } = await db!.from("contractor_unavailability")
        .insert({ contractor_id: contractorId, start_date: target.day, end_date: target.day, reason: "E2E board engine", source: "contractor" })
        .select("id").single();
      if (error) throw new Error(`unavailability: ${error.message}`);
      unavailabilityId = (blk as { id: string }).id;
      await page.reload();
      await expect(page.getByTestId("lane").first()).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("tray-search").fill(TITLE);
      card = page.getByTestId("tray-job").filter({ hasText: TITLE });
      await expect(card).toHaveCount(1);
      await expect(lane.locator(`.blk.unavailable[data-start="${target.day}"]`)).toBeVisible();

      // ---- over the blocked day: red lane, red ghost, the ghost says why ----
      const from = await centre(page, `[data-testid="tray-job"]:has-text("${TITLE}")`);
      const cellBox = await target.cell.boundingBox();
      if (!cellBox) throw new Error("no cell box");
      // Aim at the top edge of the cell — the block sits in the middle of the row, and the cell is what the engine hit-tests.
      await dragTo(page, from, { x: cellBox.x + cellBox.width / 2, y: cellBox.y + 3 });
      await expect(target.cell).toHaveClass(/hot/);
      await expect(lane).toHaveClass(/blocked/);
      await expect(page.locator(".sb .ghost")).toHaveClass(/blocked/);
      await expect(page.locator(".sb .ghost .g2")).toHaveText(/BLOCKED OUT/);
      await page.mouse.up();
      await expect(page.getByTestId("booking-dates")).toBeVisible();
      await expect(page.locator(".sheet.open")).toContainText(/blocked these days out/i);
      // Released: the lane's red is gone with the drag.
      await expect(lane).not.toHaveClass(/blocked/);
      await page.locator(".sheet.open").getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByTestId("booking-dates")).toHaveCount(0);

      // ---- a release that is not over a lane is not a drop --------------------
      const from2 = await centre(page, `[data-testid="tray-job"]:has-text("${TITLE}")`);
      const header = await page.getByTestId("board-header").boundingBox();
      if (!header) throw new Error("no header box");
      await dragTo(page, from2, { x: header.x + header.width / 2, y: header.y + 10 });
      await expect(page.locator(".sb .ghost")).toBeVisible();
      await expect(page.getByTestId("ghost-dates")).toHaveCount(0); // no day under the pointer
      await page.mouse.up();
      await expect(page.locator(".sb .ghost")).toHaveCount(0);
      await expect(page.locator(".sheet.open")).toHaveCount(0);
      await expect(page.getByTestId("booking-dates")).toHaveCount(0);
      await expect(card).toHaveCount(1);
    });
  });

  test.describe("touch viewport", () => {
    test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

    test("the same drag opens the confirm step in the one-column layout", async ({ page }) => {
      test.setTimeout(120_000);
      const card = await openBoard(page);
      // One column below 900px: the tray sits above the lanes and the page scrolls.
      const trayBox = await page.locator(".sb .tray").boundingBox();
      const tlBox = await page.locator(".sb main.tl").boundingBox();
      expect(trayBox && tlBox && tlBox.y >= trayBox.y + trayBox.height - 1, "tray above the timeline").toBe(true);

      const lane = page.getByTestId("lane").first();
      const target = await midweekCell(lane, 1);
      await target.cell.scrollIntoViewIfNeeded();
      const to = await centre(page, `[data-testid="lane"] >> nth=0 >> .bgc >> nth=${target.idx}`);
      const from = await centre(page, `[data-testid="tray-job"]:has-text("${TITLE}")`);
      // Both ends must be on screen at once for a pointer drag.
      const vh = page.viewportSize()!.height;
      expect(from.y >= 0 && from.y <= vh && to.y >= 0 && to.y <= vh, "card and cell both in the viewport").toBe(true);

      await dragTo(page, from, to, 12);
      await expect(target.cell).toHaveClass(/hot/);
      const ghost = page.getByTestId("ghost-dates");
      await expect(ghost).toBeVisible();
      expect(await ghost.getAttribute("data-start")).toBe(target.day);
      await page.mouse.up();

      const dates = page.getByTestId("booking-dates");
      await expect(dates).toBeVisible();
      expect(await dates.getAttribute("data-start")).toBe(target.day);
      await page.locator(".sheet.open").getByRole("button", { name: "Cancel" }).click();
      await expect(dates).toHaveCount(0);
      await expect(card).toHaveCount(1);
    });
  });
});
