import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";
import { addWorkingDays, addDays } from "../lib/scheduling/dates";

/**
 * Tom, 24 Sep 2026, on the scheduling board:
 *   1. "When dragging a project over a date, show the date pop up, so I know
 *      when dropping it is for the correct date." — the ghost under the
 *      pointer says the start → end it would book, and it matches the day
 *      cell it is over and the sheet that opens on the drop.
 *   2. "After dropping, in the pop up window, be able to adjust the start
 *      date." — the sheet's start is a date box; the end follows.
 *
 * One tray job, created here and removed after. Nothing is sent — the
 * sheet is cancelled.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const run = Date.now().toString(36);
const TITLE = `Drag Dates ${run}`;
let estimateId = "";
let workOrderId = "";

async function centre(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("board: dates while dragging, start date in the sheet", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the tray job");
  test.use({ viewport: { width: 1400, height: 900 } });

  test.beforeAll(async () => {
    const { data: est, error: estErr } = await db!.from("estimates")
      .insert({ status: "accepted", source: "manual", level_of_finish: 3, title: TITLE, accepted_at: new Date().toISOString() })
      .select("id").single();
    if (estErr) throw new Error(`estimate: ${estErr.message}`);
    estimateId = (est as { id: string }).id;
    const woRef = `WO-E2ED${run.slice(-4)}`;
    const { data: wo, error: woErr } = await db!.from("work_orders").insert({
      estimate_id: estimateId, wo_ref: woRef,
      share_token: `${run}dd${"x".repeat(24)}`.slice(0, 32),
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
    if (workOrderId) await db.from("work_orders").delete().eq("id", workOrderId);
    if (estimateId) await db.from("estimates").delete().eq("id", estimateId);
  });

  test("the ghost names the day under the pointer; the sheet's start date can be changed", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/schedule");
    await expect(page.getByTestId("lane").first()).toBeVisible({ timeout: 30_000 });

    const card = page.getByTestId("tray-job").filter({ hasText: TITLE });
    await expect(card).toHaveCount(1);
    const lane = page.getByTestId("lane").first();

    // A midweek cell, so the snapped start IS the cell whatever this painter's weekend flags say.
    const cells = lane.locator(".bgc");
    const n = await cells.count();
    let cellIdx = -1; let cellDay = "";
    for (let i = 2; i < Math.min(n, 20); i++) {
      const d = (await cells.nth(i).getAttribute("data-day")) ?? "";
      const dow = new Date(d + "T00:00:00Z").getUTCDay();
      if (dow >= 2 && dow <= 4) { cellIdx = i; cellDay = d; break; }
    }
    expect(cellIdx).toBeGreaterThan(0);
    const cellBox = await cells.nth(cellIdx).boundingBox();
    if (!cellBox) throw new Error("no cell box");
    const to = { x: cellBox.x + cellBox.width / 2, y: cellBox.y + cellBox.height / 2 };

    // ---- drag, and HOLD over the cell: the ghost says the dates -------------
    const from = await centre(page, `[data-testid="tray-job"]:has-text("${TITLE}")`);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    const ghost = page.getByTestId("ghost-dates");
    await expect(ghost).toBeVisible();
    const ghostStart = (await ghost.getAttribute("data-start")) ?? "";
    const ghostEnd = (await ghost.getAttribute("data-end")) ?? "";
    expect(ghostStart).toBe(cellDay);
    expect(ghostEnd >= ghostStart).toBe(true);
    await page.mouse.up();

    // ---- the sheet opens on the same dates ---------------------------------
    const dates = page.getByTestId("booking-dates");
    await expect(dates).toBeVisible();
    expect(await dates.getAttribute("data-start")).toBe(ghostStart);
    expect(await dates.getAttribute("data-end")).toBe(ghostEnd);
    const spanDays = Number(await page.getByTestId("booking-span-days").getAttribute("data-days"));

    // ---- change the start: a week later (same weekday), the end follows ----
    const later = addDays(ghostStart, 7);
    await page.getByTestId("booking-start").fill(later);
    await expect(dates).toHaveAttribute("data-start", later);
    await expect(dates).toHaveAttribute("data-end", addWorkingDays(later, spanDays));

    // ---- a Sunday snaps to the next working day (this painter or not, Monday at the latest) ----
    const sunday = addDays(later, (7 - new Date(later + "T00:00:00Z").getUTCDay()) % 7);
    await page.getByTestId("booking-start").fill(sunday);
    const snapped = (await dates.getAttribute("data-start")) ?? "";
    expect(snapped >= sunday).toBe(true);
    expect(snapped <= addDays(sunday, 1)).toBe(true);

    // Nothing is sent: close the sheet.
    await page.locator(".sheet.open").getByRole("button", { name: "Cancel" }).click();
    await expect(dates).toHaveCount(0);
  });
});
