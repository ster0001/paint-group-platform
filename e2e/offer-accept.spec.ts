import { test, expect, type Page } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";
import { addWorkingDays, workingDaysBetween } from "@/lib/scheduling/dates";

const db = serviceClient();

/**
 * The critical path named in the audit: offer a job → the contractor accepts.
 *
 * It runs against the real database, so it is careful about what it leaves
 * behind: the booking it creates is cancelled again at the end, which returns
 * the job to the unscheduled tray it came from. Read the cleanup step before
 * running this against anything you care about.
 *
 * It needs a job sitting in the tray to work with. If there isn't one it SKIPS
 * rather than inventing an estimate — a smoke test that quietly builds test data
 * in a live system is worse than no smoke test.
 *
 * NOTE: this spec has not been executed yet — the session that wrote it had a
 * contractor login but no staff login. Expect to settle a selector or two on
 * the first run.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");

/** The board's drag is pointer-based, so drive it with the mouse, not dragTo. */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several small moves: one jump can be read as a click rather than a drag.
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}

const centreOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test.describe("offer a job, contractor accepts", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));

  test("the offer reaches the contractor, and accepting books it", async ({ browser }) => {
    // Sign the contractor in FIRST, to learn which lane on the board is theirs.
    // The first lane is not it: lanes sort by company name, and a contractor who
    // hasn't filled theirs in sorts to the top. An earlier version of this test
    // dropped the job on whoever happened to be first and then waited for an
    // offer that had gone to someone else.
    const contractorContext = await browser.newContext();
    const contractorPage = await contractorContext.newPage();
    await signIn(contractorPage, contractor!, /\/portal/);
    const company = (await contractorPage.locator("header a.who").innerText())
      .split("\n")[0]
      .trim();
    test.skip(!company, "the test contractor has no company name to match a lane by");

    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    await signIn(staffPage, staff!, /\/(home|estimates)/);
    await staffPage.goto("/pc/schedule");

    // The board streams: goto() resolves while the loading skeleton is still on
    // screen, and elements inside a suspense boundary exist in the DOM without
    // being laid out — so they have a count but no bounding box. Wait for a lane
    // to be genuinely visible before measuring anything.
    await expect(staffPage.getByTestId("lane").first()).toBeVisible({ timeout: 30_000 });

    const trayJob = staffPage.getByTestId("tray-job").first();
    test.skip((await trayJob.count()) === 0, "no unscheduled job in the tray to offer");
    await expect(trayJob).toBeVisible();

    const woRef = (await trayJob.getAttribute("data-wo-ref")) ?? "";
    expect(woRef).not.toBe("");

    // --- staff: drag it onto OUR contractor's lane ---------------------------
    // Case-insensitive on purpose: the portal header is uppercased in CSS, and
    // innerText returns the RENDERED text ("KOVAC PAINTING PTY LTD") while the
    // board's attribute holds what's in the database ("Kovac Painting Pty Ltd").
    const laneSelector = `[data-testid="lane"][data-contractor-company="${company}" i]`;
    await expect(staffPage.locator(laneSelector)).toHaveCount(1);
    await dragTo(
      staffPage,
      await centreOf(staffPage, '[data-testid="tray-job"]'),
      await centreOf(staffPage, laneSelector),
    );

    // Dropping opens a confirmation — it never fires an offer by itself.
    const sendOffer = staffPage.getByRole("button", { name: "Send offer" });
    await expect(sendOffer).toBeVisible();
    // Tom, 22 Sep: the span is WORKING days — the end date skips the weekend
    // (a 7-day job from a Monday ends the following Tuesday). The e2e painter
    // works no weekends, so the sheet's end must be addWorkingDays(start, days).
    const dates = staffPage.getByTestId("booking-dates");
    const spanDays = Number(await staffPage.getByTestId("booking-span-days").getAttribute("data-days"));
    const start = (await dates.getAttribute("data-start")) ?? "";
    const end = (await dates.getAttribute("data-end")) ?? "";
    expect(spanDays).toBeGreaterThanOrEqual(1);
    expect(end).toBe(addWorkingDays(start, spanDays));
    expect(workingDaysBetween(start, end)).toBe(spanDays);
    for (const d of [start, end]) expect([0, 6]).not.toContain(new Date(d + "T00:00:00Z").getUTCDay());
    // The sheet refuses to send until the final walkthrough is confirmed
    // (date AND time) or waived (Tom, 1 Sep). Confirm it with the suggested
    // date so the walkthrough path stays exercised.
    await staffPage.locator('[data-testid="use-suggested-walkthrough"]').click();
    await staffPage.locator('[data-testid="walkthrough-time"]').fill("15:00");
    await sendOffer.click();

    // The job leaves the tray and appears on the board as a live offer, booked for exactly those days.
    await expect(staffPage.locator(`[data-testid="tray-job"][data-wo-ref="${woRef}"]`)).toHaveCount(0);
    test.skip(!db, "service key needed to read the booking back");
    const booked = await db!.from("booking_offers").select("start_date, end_date, work_orders!inner(wo_ref)").eq("work_orders.wo_ref", woRef).order("offered_at", { ascending: false }).limit(1).maybeSingle();
    if (booked.error) throw new Error(booked.error.message);
    expect(booked.data).toMatchObject({ start_date: start, end_date: end });
    await expect(staffPage.locator(".blk.offered").first()).toBeVisible();

    // --- contractor: the offer is waiting, with the address still redacted ---
    const requests = await contractorPage.goto("/portal/requests");
    const html = (await requests?.text()) ?? "";
    // Until they accept, the customer's street address must not be in the page
    // at all — this is the privacy gate, checked against the response body.
    expect(html).toMatch(/awaiting your answer|accept/i);

    const accept = contractorPage.getByRole("button", { name: /accept/i }).first();
    await expect(accept).toBeVisible();
    await accept.click();

    await expect(contractorPage.locator("body")).toContainText(/booked|accepted/i, { timeout: 20_000 });

    // --- staff: it now reads as booked ---------------------------------------
    await staffPage.reload();
    await expect(staffPage.locator(".blk.accepted").first()).toBeVisible();

    // --- cleanup: put the job back in the tray -------------------------------
    await staffPage.locator(".blk.accepted").first().click();
    const cancelBooking = staffPage.getByRole("button", { name: /cancel this booking/i });
    if (await cancelBooking.count()) {
      await staffPage.getByPlaceholder(/customer postponed/i).fill("e2e smoke test cleanup");
      await cancelBooking.click();
      await expect(staffPage.locator(`[data-testid="tray-job"][data-wo-ref="${woRef}"]`)).toHaveCount(1, {
        timeout: 20_000,
      });
    }

    await staffContext.close();
    await contractorContext.close();
  });
});
