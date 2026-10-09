import { test, expect, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, rpcAs, serviceClient } from "./fixtures/woLoop";
import { addDays, addWorkingDays, type WorkingWeek } from "../lib/scheduling/dates";

/**
 * Tom, 8 Oct 2026: "In scheduler: update the system so we can update the end
 * date for an in-progress job."
 *
 * Before: an in-progress block on the PC Command board could not be dragged
 * (its start must not move once the painter has started) and its sheet had no
 * way to change the last day. Now the sheet carries a Finish date control that
 * moves the END only — through `wo_contractor_set_finish_date`, the function
 * that already owns the finish date, so the booking, the work order and the
 * final walkthrough all follow. A non-working day snaps to the painter's next
 * working day, the same rule the drop uses.
 *
 * The database half (migration 20270245): move_booking and reassign_dates
 * refuse to move the START of a started job ('error:started'), and an accepted
 * booking's moved end reaches work_orders.end_date.
 *
 * Jobs are created here against the e2e contractor's lane and removed after.
 * Nothing is offered; no message goes to the painter or the customer.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const run = Date.now().toString(36);
const TITLE = `End Date Running ${run}`;

let contractorId = "";
let week: WorkingWeek = {};
const made: { estimateId: string; workOrderId: string }[] = [];
let job = { workOrderId: "", woRef: "", offerId: "" };
let start = "", oldEnd = "";

function melbToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
/** The latest Monday–Friday on or before `d` — a start that has already happened. */
function weekdayOnOrBefore(d: string): string {
  let x = d;
  while ([0, 6].includes(new Date(x + "T00:00:00Z").getUTCDay())) x = addDays(x, -1);
  return x;
}
function nextSaturdayAfter(d: string): string {
  let x = addDays(d, 1);
  while (new Date(x + "T00:00:00Z").getUTCDay() !== 6) x = addDays(x, 1);
  return x;
}

async function makeRunningJob(title: string, refSuffix: string, s: string, e: string, withOffer: boolean) {
  const { data: est, error: estErr } = await db!.from("estimates")
    .insert({ status: "accepted", source: "manual", level_of_finish: 3, title, accepted_at: new Date().toISOString() })
    .select("id").single();
  if (estErr) throw new Error(`estimate: ${estErr.message}`);
  const estimateId = (est as { id: string }).id;
  const woRef = `WO-E2EN${refSuffix}${run.slice(-3)}`;
  const { data: wo, error: woErr } = await db!.from("work_orders").insert({
    estimate_id: estimateId, wo_ref: woRef,
    share_token: `${run}${refSuffix}${"y".repeat(28)}`.slice(0, 32),
    stage: "in_progress", status: "in_progress", issued_at: new Date().toISOString(),
    contractor_id: contractorId, start_date: s, end_date: e,
    wo_snapshot: {
      version: 1, woRef, status: "in_progress", jobTitle: title,
      jobAddress: "1 Test St, Brunswick, VIC, 3000",
      contactFirstName: "Test", contactPhone: "", startDate: s,
      accessNotes: "", crewNotes: "", levelOfFinish: "Level 3", finishCode: "PG-3",
      contractorName: "", contractorPaymentCents: 120000, materials: [], areas: [],
      exclusions: [], company: { name: "Paint Group", phone: "", logoUrl: "" },
    },
  }).select("id").single();
  if (woErr) throw new Error(`work order: ${woErr.message}`);
  const workOrderId = (wo as { id: string }).id;
  made.push({ estimateId, workOrderId });
  let offerId = "";
  if (withOffer) {
    const { data: o, error } = await db!.from("booking_offers").insert({
      work_order_id: workOrderId, contractor_id: contractorId, state: "accepted",
      start_date: s, end_date: e, payment_cents: 120000,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      responded_at: new Date().toISOString(), accepted_at: new Date().toISOString(),
    }).select("id").single();
    if (error) throw new Error(`accepted offer: ${error.message}`);
    offerId = (o as { id: string }).id;
  }
  return { workOrderId, woRef, offerId };
}

async function dates(workOrderId: string) {
  const [o, w] = await Promise.all([
    db!.from("booking_offers").select("start_date, end_date").eq("work_order_id", workOrderId).eq("state", "accepted").maybeSingle(),
    db!.from("work_orders").select("start_date, end_date").eq("id", workOrderId).single(),
  ]);
  if (o.error) throw new Error(o.error.message);
  if (w.error) throw new Error(w.error.message);
  return { offer: o.data as { start_date: string; end_date: string } | null, wo: w.data as { start_date: string; end_date: string } };
}

test.describe("board: change the end date of a job that is under way", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the jobs");
  test.use({ viewport: { width: 1500, height: 900 } });

  test.beforeAll(async () => {
    const cid = await contractorIdForEmail(db!, contractor!.email);
    if (!cid) throw new Error("the e2e contractor has no contractors row");
    contractorId = cid;
    const { data: c, error } = await db!.from("contractors").select("works_saturday, works_sunday").eq("id", cid).single();
    if (error) throw new Error(error.message);
    week = { saturday: Boolean((c as { works_saturday: boolean | null }).works_saturday), sunday: Boolean((c as { works_sunday: boolean | null }).works_sunday) };

    // Started on the last weekday on or before today; four working days long.
    start = weekdayOnOrBefore(addDays(melbToday(), -1));
    oldEnd = addWorkingDays(start, 4, {});
    job = await makeRunningJob(TITLE, "A", start, oldEnd, true);
    // The final walkthrough confirmed with the client for the old last day, 3pm.
    const { error: wErr } = await db!.from("wo_walkthroughs").insert({
      work_order_id: job.workOrderId, kind: "final", scheduled_date: oldEnd, scheduled_time: "15:00", note: "e2e",
    });
    if (wErr) throw new Error(`walkthrough: ${wErr.message}`);
  });

  test.afterAll(async () => {
    if (!db) return;
    // Offers, walkthroughs, assignments and events cascade from the work order.
    for (const m of made) await db.from("work_orders").delete().eq("id", m.workOrderId);
    for (const m of made) await db.from("estimates").delete().eq("id", m.estimateId);
  });

  async function openBoard(page: Page): Promise<Locator> {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/schedule?from=${addDays(start, -7)}&days=28`);
    const lane = page.locator(`[data-testid="lane"][data-contractor-id="${contractorId}"]`);
    await expect(lane).toBeVisible({ timeout: 30_000 });
    const block = lane.locator(`.blk[data-work-order-id="${job.workOrderId}"]`).first();
    await expect(block).toBeVisible();
    return block;
  }

  test("an in-progress block's sheet moves the END only; booking, work order and final walkthrough follow", async ({ page }) => {
    test.setTimeout(120_000);
    const block = await openBoard(page);
    await expect(block).toHaveClass(/in_progress/);
    await expect(block).toHaveAttribute("data-start", start);
    await expect(block).toHaveAttribute("data-end", oldEnd);

    // Dragging a started job does nothing — no "Move this booking?" sheet.
    const box = await block.boundingBox();
    if (!box) throw new Error("no block box");
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + 20 + i * 30, box.y + box.height / 2);
    await page.mouse.up();
    await expect(page.getByTestId("booking-dates")).toHaveCount(0);

    await block.click();
    const row = page.getByTestId("finish-date-row");
    await expect(row).toBeVisible();
    await expect(row).toContainText(/start stays/i);
    const input = page.getByTestId("finish-date");
    await expect(input).toHaveValue(oldEnd);
    await expect(input).toHaveAttribute("min", start);

    // A Saturday the painter may not work → their next working day.
    const saturday = nextSaturdayAfter(oldEnd);
    const expected = addWorkingDays(saturday, 1, week);
    await input.fill(saturday);
    await expect(page.getByTestId("finish-date-snapped")).toHaveAttribute("data-end", expected);
    await page.getByTestId("finish-date-save").click();

    await expect(block).toHaveAttribute("data-end", expected, { timeout: 20_000 });
    await expect(block).toHaveAttribute("data-start", start);
    await page.screenshot({ path: test.info().outputPath("finish-date-moved.png") });

    const d = await dates(job.workOrderId);
    expect(d.offer).toEqual({ start_date: start, end_date: expected });
    expect(d.wo).toEqual({ start_date: start, end_date: expected });

    const { data: walks, error: wErr } = await db!.from("wo_walkthroughs")
      .select("scheduled_date, scheduled_time, status").eq("work_order_id", job.workOrderId).eq("kind", "final")
      .order("created_at", { ascending: true });
    if (wErr) throw new Error(wErr.message);
    expect(walks).toEqual([
      { scheduled_date: oldEnd, scheduled_time: "15:00:00", status: "cancelled" },
      { scheduled_date: expected, scheduled_time: "15:00:00", status: "booked" },
    ]);

    const { data: ev, error: eErr } = await db!.from("wo_events")
      .select("actor_kind, meta").eq("work_order_id", job.workOrderId).eq("type", "finish_date_changed");
    if (eErr) throw new Error(eErr.message);
    expect(ev).toHaveLength(1);
    expect((ev as { actor_kind: string; meta: { from: string; to: string } }[])[0]).toMatchObject({ actor_kind: "staff", meta: { from: oldEnd, to: expected } });
  });

  test("the sheet refuses a finish before the start, in words", async ({ page }) => {
    test.setTimeout(90_000);
    const block = await openBoard(page);
    await block.click();
    const before = await dates(job.workOrderId);
    await page.getByTestId("finish-date").fill(addDays(start, -3));
    await page.getByTestId("finish-date-save").click();
    await expect(page.getByTestId("finish-date-msg")).toContainText(/before the job started/i, { timeout: 15_000 });
    expect(await dates(job.workOrderId)).toEqual(before);
  });

  test("the database keeps a started job's start: move_booking and reassign_dates say 'started'; the end still moves", async () => {
    const before = await dates(job.workOrderId);
    expect(await rpcAs(staff!, "move_booking", {
      p_offer_id: job.offerId, p_start: addDays(start, 1), p_end: before.offer!.end_date, p_expected_state: "accepted",
    })).toBe("error:started");
    expect(await dates(job.workOrderId)).toEqual(before);

    // Same start, a later end → the booking AND the work order carry it.
    const later = addWorkingDays(before.offer!.end_date, 2, {});
    expect(await rpcAs(staff!, "move_booking", {
      p_offer_id: job.offerId, p_start: start, p_end: later, p_expected_state: "accepted",
    })).toBe("ok:moved");
    expect(await dates(job.workOrderId)).toEqual({ offer: { start_date: start, end_date: later }, wo: { start_date: start, end_date: later } });

    // An employee's days on a running job: the start is history, the end is not.
    const crew = await makeRunningJob(`${TITLE} crew`, "C", start, oldEnd, false);
    const { data: a, error } = await db!.from("wo_assignments").insert({
      work_order_id: crew.workOrderId, contractor_id: contractorId, start_date: start, end_date: oldEnd,
      is_lead: true, status: "accepted", accepted_at: new Date().toISOString(),
    }).select("id").single();
    if (error) throw new Error(`assignment: ${error.message}`);
    const assignmentId = (a as { id: string }).id;
    expect(await rpcAs(staff!, "reassign_dates", {
      p_assignment_id: assignmentId, p_start: addDays(start, 1), p_end: oldEnd, p_override_reason: "e2e",
    })).toBe("error:started");
    const crewEnd = addWorkingDays(oldEnd, 3, {});
    expect(await rpcAs(staff!, "reassign_dates", {
      p_assignment_id: assignmentId, p_start: start, p_end: crewEnd, p_override_reason: "e2e",
    })).toBe("ok:moved");
    const c = await dates(crew.workOrderId);
    expect(c.wo).toEqual({ start_date: start, end_date: crewEnd });
  });
});
