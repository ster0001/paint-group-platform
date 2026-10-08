import { test, expect, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, serviceClient } from "./fixtures/woLoop";
import { addDays } from "../lib/scheduling/dates";

/**
 * Tom, 1 Oct 2026, on the scheduling board:
 *   1. "Allow to be able to drag an empty space to add an appointment which
 *      has already been added to the calendar a 2nd time" — a painter booked
 *      on a job gets a SECOND run of days on it, drawn in the job's colour.
 *   2. "Reserve a space in the calendar internally … colour it in bright pink
 *      as an unconfirmed appointment" — a hold, pink, released by hand or
 *      answered by the booking.
 *
 * One booked job and one unbooked tray job, created here against the e2e
 * contractor's lane and removed after. Nothing is offered; the painter never
 * receives anything.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const run = Date.now().toString(36);
const BOOKED = `Hold Visit Booked ${run}`;
const WAITING = `Hold Visit Waiting ${run}`;
let contractorId = "";
let bookedEstimate = "", bookedWo = "", bookedRef = "";
let waitingEstimate = "", waitingWo = "";
/** Monday a fortnight-and-a-bit out: the board opens on today, 14 days wide. */
let bookedStart = "", bookedEnd = "";

function nextMonday(from: string, atLeastDays: number): string {
  let d = addDays(from, atLeastDays);
  while (new Date(d + "T00:00:00Z").getUTCDay() !== 1) d = addDays(d, 1);
  return d;
}

async function makeJob(title: string, refSuffix: string, booked: boolean) {
  const { data: est, error: estErr } = await db!.from("estimates")
    .insert({ status: "accepted", source: "manual", level_of_finish: 3, title, accepted_at: new Date().toISOString() })
    .select("id").single();
  if (estErr) throw new Error(`estimate: ${estErr.message}`);
  const estimateId = (est as { id: string }).id;
  const woRef = `WO-E2EH${refSuffix}${run.slice(-3)}`;
  const { data: wo, error: woErr } = await db!.from("work_orders").insert({
    estimate_id: estimateId, wo_ref: woRef,
    share_token: `${run}${refSuffix}${"x".repeat(24)}`.slice(0, 32),
    stage: "pre_start", status: "issued", issued_at: new Date().toISOString(),
    ...(booked ? { contractor_id: contractorId, start_date: bookedStart, end_date: bookedEnd } : {}),
    wo_snapshot: {
      version: 1, woRef, status: "issued", jobTitle: title,
      jobAddress: "1 Test St, Brunswick, VIC, 3000",
      contactFirstName: "Test", contactPhone: "", startDate: booked ? bookedStart : null,
      accessNotes: "", crewNotes: "", levelOfFinish: "Level 3", finishCode: "PG-3",
      contractorName: "", contractorPaymentCents: 120000, materials: [], areas: [],
      exclusions: [], company: { name: "Paint Group", phone: "", logoUrl: "" },
    },
  }).select("id").single();
  if (woErr) throw new Error(`work order: ${woErr.message}`);
  const workOrderId = (wo as { id: string }).id;
  if (booked) {
    const { error } = await db!.from("booking_offers").insert({
      work_order_id: workOrderId, contractor_id: contractorId, state: "accepted",
      start_date: bookedStart, end_date: bookedEnd, payment_cents: 120000,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      responded_at: new Date().toISOString(), accepted_at: new Date().toISOString(),
    });
    if (error) throw new Error(`accepted offer: ${error.message}`);
  }
  return { estimateId, workOrderId, woRef };
}

/** The lane's empty day cells for a run of dates, by their data-day. */
async function cellCentre(lane: Locator, day: string) {
  const cell = lane.locator(`.bgc[data-day="${day}"]`);
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  if (!box) throw new Error(`no cell for ${day}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag across empty lane space — the marquee that opens the block-out sheet. */
async function dragEmpty(page: Page, lane: Locator, from: string, to: string) {
  const a = await cellCentre(lane, from);
  const b = await cellCentre(lane, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
  await page.mouse.up();
}

test.describe("board: a second visit on a booked job, and a pink hold", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the jobs");
  test.use({ viewport: { width: 1500, height: 900 } });

  test.beforeAll(async () => {
    const cid = await contractorIdForEmail(db!, contractor!.email);
    if (!cid) throw new Error("the e2e contractor has no contractors row");
    contractorId = cid;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    // Booked Mon–Tue of the week after next; the visit goes on that Thu–Fri,
    // the hold on the following Mon–Tue. All inside a 4-week board window.
    bookedStart = nextMonday(today, 10);
    bookedEnd = addDays(bookedStart, 1);
    const b = await makeJob(BOOKED, "B", true);
    bookedEstimate = b.estimateId; bookedWo = b.workOrderId; bookedRef = b.woRef;
    const w = await makeJob(WAITING, "W", false);
    waitingEstimate = w.estimateId; waitingWo = w.workOrderId;
  });

  test.afterAll(async () => {
    if (!db) return;
    // Visits and holds cascade from the work orders; offers too.
    for (const id of [bookedWo, waitingWo]) if (id) await db.from("work_orders").delete().eq("id", id);
    for (const id of [bookedEstimate, waitingEstimate]) if (id) await db.from("estimates").delete().eq("id", id);
  });

  async function openBoard(page: Page) {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/schedule?from=${addDays(bookedStart, -7)}&days=28`);
    const lane = page.locator(`[data-testid="lane"][data-contractor-id="${contractorId}"]`);
    await expect(lane).toBeVisible({ timeout: 30_000 });
    // The booked job is on the lane before anything is dragged.
    await expect(lane.locator(`.blk:has-text("${bookedRef}")`).first()).toBeVisible();
    return lane;
  }

  test("drag empty space → Extra visit → the job appears a second time, in its own colour, and can be removed", async ({ page }) => {
    test.setTimeout(120_000);
    const lane = await openBoard(page);
    const visitStart = addDays(bookedStart, 3); // Thursday
    const visitEnd = addDays(bookedStart, 4);   // Friday

    await dragEmpty(page, lane, visitStart, visitEnd);
    const dates = page.getByTestId("empty-drag-dates");
    await expect(dates).toBeVisible();
    expect(await dates.getAttribute("data-start")).toBe(visitStart);
    expect(await dates.getAttribute("data-end")).toBe(visitEnd);

    await page.getByTestId("mode-visit").click();
    // Tom, 4 Oct: the project is SEARCHED, not picked from this row's jobs.
    await page.getByTestId("visit-search").fill(bookedRef);
    await page.locator(`[data-testid="visit-hit"][data-work-order-id="${bookedWo}"]`).click();
    await expect(page.getByTestId("visit-picked")).toHaveAttribute("data-work-order-id", bookedWo);
    await page.getByTestId("visit-note").fill("back to finish the ceilings");
    await page.getByTestId("visit-save").click();

    const visit = lane.locator(`[data-testid="visit-block"][data-work-order-id="${bookedWo}"]`);
    await expect(visit).toBeVisible({ timeout: 20_000 });
    await expect(visit).toHaveClass(/accepted/); // the job's colour, not a new one
    await expect(visit).toContainText("EXTRA VISIT");
    // Two blocks for one job on one lane: the original booking and the visit.
    await expect(lane.locator(`.blk:has-text("${bookedRef}")`)).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath("visit-added.png") });

    const { data: rows, error } = await db!.from("wo_appointments").select("start_date, end_date, note, contractor_id").eq("work_order_id", bookedWo);
    if (error) throw new Error(error.message);
    expect(rows).toEqual([{ start_date: visitStart, end_date: visitEnd, note: "back to finish the ceilings", contractor_id: contractorId }]);

    // The painter's calendar reads the same rows — RLS lets them see their own.
    // (Covered at the policy level: the SELECT policy is contractor_id = current_contractor_id().)

    await visit.click();
    await expect(page.getByTestId("visit-detail")).toBeVisible();
    await page.getByTestId("visit-remove").click();
    await expect(visit).toHaveCount(0, { timeout: 20_000 });
    const { data: after } = await db!.from("wo_appointments").select("id").eq("work_order_id", bookedWo);
    expect(after ?? []).toHaveLength(0);
  });

  test("an extra visit can go on ANY project — one this painter isn't on, found by its title — and a second one after it", async ({ page }) => {
    test.setTimeout(120_000);
    const lane = await openBoard(page);
    const visitStart = addDays(bookedStart, 2); // Wednesday
    const second = addDays(bookedStart, 14);   // the Monday a fortnight on

    await dragEmpty(page, lane, visitStart, visitStart);
    await page.getByTestId("mode-visit").click();
    // The waiting job has no painter at all; search by title, not reference.
    await page.getByTestId("visit-search").fill(WAITING.slice(0, 18));
    await page.locator(`[data-testid="visit-hit"][data-work-order-id="${waitingWo}"]`).click();
    await page.getByTestId("visit-save").click();
    const visit = lane.locator(`[data-testid="visit-block"][data-work-order-id="${waitingWo}"]`);
    await expect(visit).toBeVisible({ timeout: 20_000 });

    // "Currently it only allows one" — a second visit on the same row goes in too.
    await dragEmpty(page, lane, second, second);
    await page.getByTestId("mode-visit").click();
    await page.getByTestId("visit-search").fill(bookedRef);
    await page.locator(`[data-testid="visit-hit"][data-work-order-id="${bookedWo}"]`).click();
    await page.getByTestId("visit-save").click();
    await expect(lane.locator(`[data-testid="visit-block"][data-work-order-id="${bookedWo}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(lane.locator('[data-testid="visit-block"]')).toHaveCount(2);

    const { data: rows } = await db!.from("wo_appointments").select("work_order_id").eq("contractor_id", contractorId).in("work_order_id", [bookedWo, waitingWo]);
    expect((rows ?? []).map((r) => r.work_order_id).sort()).toEqual([bookedWo, waitingWo].sort());
    // Leave the board clean for the hold tests.
    await db!.from("wo_appointments").delete().in("work_order_id", [bookedWo, waitingWo]);
  });

  test("drag empty space → Hold → a bright pink block the painter never sees; releasing it clears the days", async ({ page }) => {
    test.setTimeout(120_000);
    const lane = await openBoard(page);
    const holdStart = addDays(bookedStart, 7); // next Monday
    const holdEnd = addDays(bookedStart, 8);

    await dragEmpty(page, lane, holdStart, holdEnd);
    await page.getByTestId("mode-hold").click();
    await page.getByTestId("hold-job").selectOption(waitingWo);
    await page.getByTestId("hold-note").fill("client confirming by Friday");
    await page.getByTestId("hold-save").click();

    const hold = lane.locator(`[data-testid="hold-block"][data-work-order-id="${waitingWo}"]`);
    await expect(hold).toBeVisible({ timeout: 20_000 });
    await expect(hold).toHaveClass(/\bhold\b/);
    await expect(hold).toContainText("HELD");
    // Bright pink, measured — a hold must never read as a booking.
    const bg = await hold.evaluate((el) => getComputedStyle(el).borderColor);
    expect(bg.replace(/\s/g, "")).toBe("rgb(255,45,155)");
    await page.screenshot({ path: test.info().outputPath("hold-pink.png") });

    // Internal: the painter's own session cannot read the row at all.
    const { createClient } = await import("@supabase/supabase-js");
    const asPainter = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const signed = await asPainter.auth.signInWithPassword({ email: contractor!.email, password: contractor!.password });
    if (signed.error) throw new Error(signed.error.message);
    const painterRead = await asPainter.from("schedule_holds").select("id").eq("contractor_id", contractorId);
    await asPainter.auth.signOut().catch(() => {});
    expect(painterRead.error).toBeNull();
    expect(painterRead.data ?? []).toHaveLength(0);

    await hold.click();
    await expect(page.getByTestId("hold-detail")).toBeVisible();
    await expect(page.getByTestId("hold-book")).toBeVisible(); // the waiting job is in the tray, so it can be booked from here
    await page.getByTestId("hold-release").click();
    await expect(hold).toHaveCount(0, { timeout: 20_000 });
    const { data: rows } = await db!.from("schedule_holds").select("released_at, note").eq("work_order_id", waitingWo);
    expect(rows).toHaveLength(1);
    expect(rows![0].released_at).not.toBeNull();
    expect(rows![0].note).toBe("client confirming by Friday");
  });

  test("drop a tray job and choose Hold instead of sending — the dates go pink without an offer", async ({ page }) => {
    test.setTimeout(120_000);
    const lane = await openBoard(page);
    const dropDay = addDays(bookedStart, 9); // Wednesday the week after

    await page.getByTestId("tray-search").fill(WAITING);
    const card = page.getByTestId("tray-job").filter({ hasText: WAITING });
    await expect(card).toHaveCount(1);
    await card.scrollIntoViewIfNeeded();
    const from = await card.boundingBox();
    const to = await cellCentre(lane, dropDay);
    if (!from) throw new Error("no tray card box");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + from.width / 2 + ((to.x - from.x - from.width / 2) * i) / 8, from.y + from.height / 2 + ((to.y - from.y - from.height / 2) * i) / 8);
    await page.mouse.up();

    await expect(page.getByTestId("booking-dates")).toBeVisible();
    await page.getByTestId("drop-hold").click();

    const hold = lane.locator(`[data-testid="hold-block"][data-work-order-id="${waitingWo}"]`);
    await expect(hold).toBeVisible({ timeout: 20_000 });
    // Still in the tray — nothing was offered.
    await expect(page.getByTestId("tray-job").filter({ hasText: WAITING })).toHaveCount(1);
    const { data: offers } = await db!.from("booking_offers").select("id").eq("work_order_id", waitingWo);
    expect(offers ?? []).toHaveLength(0);
    const { data: holds } = await db!.from("schedule_holds").select("start_date, released_at").eq("work_order_id", waitingWo).is("released_at", null);
    expect(holds).toHaveLength(1);
    expect(holds![0].start_date).toBe(dropDay);
  });
});
