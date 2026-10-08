import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, userIdFor } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";
import { workingDayBefore } from "@/lib/workorder/qaSchedule";
import { melbourneDate } from "@/lib/workorder/console";

/**
 * Tom, 8 Oct 2026 (migration 20270247):
 *   "When a quality check is required on a job there needs to be an option to
 *    schedule it in Felipe's calendar, before the final walk through. If the
 *    contractor is new … this should be done at the point of booking the job.
 *    There also needs to be the option to add additional job check-ins in the
 *    PC Command … If the final walk through date is adjusted, the quality check
 *    date needs to be adjusted accordingly."
 *
 *   1. booking — the accepted offer runs the cadence and puts the check on the
 *      working day before the final, 09:00;
 *   2. the office moves it on the PC job page; the calendar invite to whoever
 *      is ticked for "QA invite" is recorded; a time after the final is refused;
 *   3. the final moves → the check follows, keeping its time, and the invite
 *      is re-sent;
 *   4. the final cancelled → the check stays, PC Command flags it;
 *   5. a site check-in added from the PC is on PC Command on its day and goes
 *      when it is marked visited (since 9 Oct a visit, not a check — 20270248;
 *      e2e/site-checkins.spec.ts covers the rest);
 *   6. none of it reaches an anonymous visitor (the /w token page, the API).
 *
 * The test project sends no email, so the recorded outcome is
 * "not_configured" — the point is that the invite is ATTEMPTED to the ticked
 * person and the outcome is recorded. Everything created here is removed in
 * afterAll (fixture cascade, the staff alert tick, the recorded messages).
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;
let woRef = "";
let shareToken = "";
let staffId = "";
let savedNotify: unknown = null;
let holidays = new Set<string>();
let checkId = "";

const two = (n: number) => String(n).padStart(2, "0");
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
};
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
// A Monday six weeks out: far from any real booking on the test project.
let start = addDays(melbourneDate(new Date()), 42);
while (weekdayOf(start) !== 1) start = addDays(start, 1);
const end = addDays(start, 4);            // Friday — the booked last day, and the final
const movedFinal = addDays(start, 8);     // the next Tuesday

const mainCheck = async () => {
  const { data, error } = await db!.from("wo_qa_checks")
    .select("id, kind, result, scheduled_for, scheduled_time").eq("work_order_id", job!.workOrderId).eq("kind", "final");
  if (error) throw error;
  return (data ?? []) as { id: string; kind: string; result: string | null; scheduled_for: string | null; scheduled_time: string | null }[];
};
const invites = async () => {
  const { data, error } = await db!.from("wo_events").select("meta, created_at")
    .eq("work_order_id", job!.workOrderId).eq("type", "qa_check_invite").order("created_at");
  if (error) throw error;
  return (data ?? []) as { meta: { check_id: string; date: string; time: string | null; outcome: string; method: string; sequence: number; to: { profile_id: string; status: string }[] } }[];
};

test.describe.configure({ mode: "serial" });

test.describe("quality checks: scheduled at booking, before the final, followed and flagged", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    const reset = await db!.from("work_orders").update({
      stage: "offered", status: "issued", contractor_id: null, start_date: null, end_date: null,
    }).eq("id", job.workOrderId).select("wo_ref, share_token").single();
    if (reset.error) throw reset.error;
    woRef = (reset.data as { wo_ref: string }).wo_ref;
    shareToken = (reset.data as { share_token: string }).share_token;

    // The office's "QA invite" tick on the e2e staff login, for this run only.
    staffId = (await userIdFor(staff!)) ?? "";
    const prof = await db!.from("profiles").select("staff_notify").eq("id", staffId).single();
    if (prof.error) throw prof.error;
    savedNotify = (prof.data as { staff_notify: unknown }).staff_notify;
    const ticked = await db!.from("profiles")
      .update({ staff_notify: { ...((savedNotify as Record<string, unknown> | null) ?? {}), office_qa_check_invite: ["email"] } })
      .eq("id", staffId);
    if (ticked.error) throw ticked.error;

    const rules = await db!.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
    if (rules.error) throw rules.error;
    const list = (rules.data as { value?: { publicHolidays?: string[] } } | null)?.value?.publicHolidays ?? [];
    holidays = new Set(list);
  });

  test.afterAll(async () => {
    if (staffId) {
      const { error } = await db!.from("profiles").update({ staff_notify: savedNotify ?? {} }).eq("id", staffId);
      if (error) throw error;
    }
    if (woRef) {
      const { error } = await db!.from("messages").delete().ilike("subject", `%(${woRef})%`);
      if (error) throw error;
    }
    await destroyLoopFixture(db!, job);
  });

  test("booking: the accepted offer schedules the check on the working day before the final, 09:00", async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    expect(await rpcAs(staff!, "send_offer", {
      p_work_order_id: job!.workOrderId, p_contractor_id: contractorId, p_start: start, p_end: end, p_note: "",
    })).toMatch(/^ok|offered/);
    // The booking sheet confirms the final with the client at offer time.
    expect(await rpcAs(staff!, "wo_book_walkthrough", {
      p_work_order_id: job!.workOrderId, p_kind: "final", p_date: end, p_note: "", p_time: "15:00",
    })).toMatch(/^ok:/);
    // The cadence decides WHO is checked (new painter / the office's flag);
    // the office's flag makes this run independent of the e2e painter's record.
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: job!.workOrderId, p_required: true })).toBe("ok:true");
    const before = await mainCheck();
    expect(before).toHaveLength(1);
    expect(before[0].scheduled_for).toBeNull();

    const { data: offer, error } = await db!.from("booking_offers").select("id")
      .eq("work_order_id", job!.workOrderId).eq("state", "offered").single();
    if (error) throw error;
    expect(await rpcAs(contractor!, "respond_to_offer", { p_offer_id: (offer as { id: string }).id, p_action: "accept", p_note: "" })).toMatch(/accepted/);

    const [placed] = await mainCheck();
    checkId = placed.id;
    expect(placed.scheduled_for).toBe(workingDayBefore(end, holidays));
    expect(placed.scheduled_time).toBe("09:00:00");
    const { data: ev, error: evErr } = await db!.from("wo_events").select("meta")
      .eq("work_order_id", job!.workOrderId).eq("type", "qa_check_scheduled");
    if (evErr) throw evErr;
    expect(((ev ?? []) as { meta: { via: string } }[]).some((e) => e.meta.via === "booking")).toBe(true);
  });

  test("the office moves it on the PC job page; the invite is recorded; after the final is refused", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    const row = page.getByTestId(`qa-row-${checkId}`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId(`qa-when-${checkId}`)).toContainText(`${workingDayBefore(end, holidays)} 09:00`);
    await expect(page.getByTestId("qa-final-line")).toContainText(end);

    // After the final (same day, later time) — refused before the round trip.
    await page.getByTestId(`qa-schedule-open-${checkId}`).click();
    await page.getByTestId(`qa-schedule-date-${checkId}`).fill(end);
    await page.getByTestId(`qa-schedule-time-${checkId}`).fill("16:00");
    await page.getByTestId(`qa-schedule-save-${checkId}`).click();
    await expect(page.getByTestId(`qa-schedule-msg-${checkId}`)).toContainText(/before the final walkthrough/i);
    // …and by the server, whoever calls it.
    expect(await rpcAs(staff!, "wo_qa_set_schedule", { p_check_id: checkId, p_date: end, p_time: "16:00" })).toBe("error:after_final");

    const wednesday = addDays(start, 2);
    await page.getByTestId(`qa-schedule-date-${checkId}`).fill(wednesday);
    await page.getByTestId(`qa-schedule-time-${checkId}`).fill("10:30");
    await page.getByTestId(`qa-schedule-save-${checkId}`).click();
    await expect(page.getByTestId(`qa-schedule-msg-${checkId}`)).toContainText(/Scheduled/);
    const [moved] = await mainCheck();
    expect(moved.scheduled_for).toBe(wednesday);
    expect(moved.scheduled_time).toBe("10:30:00");

    // The invite goes after the response: poll for its record.
    await expect.poll(async () => (await invites()).filter((e) => e.meta.date === wednesday).length, { timeout: 30_000 }).toBe(1);
    const sent = (await invites()).find((e) => e.meta.date === wednesday)!;
    expect(sent.meta).toMatchObject({ check_id: checkId, method: "REQUEST", time: "10:30", outcome: "not_configured" });
    expect(sent.meta.to.map((t) => t.profile_id)).toContain(staffId);
    await page.reload();
    await expect(page.getByTestId(`qa-invite-${checkId}`)).toContainText(/email is not set up/i);
  });

  test("the final moves → the check follows to the working day before, keeping its time, and the invite follows", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    await expect(page.getByTestId("walkthrough-card")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("walkthrough-date").fill(movedFinal);
    await page.getByTestId("walkthrough-time").fill("14:00");
    await page.getByTestId("book-final").click();
    await expect(page.getByTestId("walkthrough-msg")).toContainText(/booked/i, { timeout: 30_000 });

    const expected = workingDayBefore(movedFinal, holidays);
    const [followed] = await mainCheck();
    expect(followed.scheduled_for).toBe(expected);
    expect(followed.scheduled_time).toBe("10:30:00");
    await expect.poll(async () => (await invites()).filter((e) => e.meta.date === expected).length, { timeout: 30_000 }).toBe(1);
  });

  test("the final cancelled → the check stays where it is and PC Command flags it", async ({ page }) => {
    const { data: w, error } = await db!.from("wo_walkthroughs").select("id")
      .eq("work_order_id", job!.workOrderId).eq("kind", "final").eq("status", "booked").single();
    if (error) throw error;
    expect(await rpcAs(staff!, "wo_set_walkthrough_status", { p_walkthrough_id: (w as { id: string }).id, p_status: "cancelled" })).toMatch(/^ok/);
    const [stayed] = await mainCheck();
    expect(stayed.scheduled_for).toBe(workingDayBefore(movedFinal, holidays));

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.locator(`[data-testid^="qa-card-qa_check_final_cancelled:work_order:${job!.workOrderId}:"]`);
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(/final walkthrough was cancelled/);
  });

  test("a site check-in added from the PC is on PC Command on its day, and Mark visited clears it", async ({ page }) => {
    // The job is under way.
    const running = await db!.from("work_orders").update({ stage: "in_progress" }).eq("id", job!.workOrderId);
    if (running.error) throw running.error;

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    await page.getByTestId("qa-mid-open").click();
    await page.getByTestId("qa-mid-date").fill(melbourneDate(new Date()));
    await page.getByTestId("qa-mid-time").fill("23:45");
    await page.getByTestId("qa-mid-add").click();
    await expect(page.getByTestId("qa-controls-msg")).toContainText(/check-in added/i, { timeout: 30_000 });

    // Tom, 9 Oct 2026 (20270248): a site check-in is a visit, not a check.
    const { data: rows, error } = await db!.from("wo_site_visits").select("id, scheduled_time")
      .eq("work_order_id", job!.workOrderId);
    if (error) throw error;
    const visit = (rows as { id: string; scheduled_time: string }[])[0];
    expect(visit.scheduled_time).toBe("23:45:00");
    const { data: mids, error: midErr } = await db!.from("wo_qa_checks").select("id").eq("work_order_id", job!.workOrderId).eq("kind", "mid");
    if (midErr) throw midErr;
    expect(mids ?? []).toHaveLength(0);

    await page.goto("/pc");
    const due = page.getByTestId(`site-visit-card-site_visit_due:work_order:${job!.workOrderId}:${visit.id}`);
    await expect(due).toBeVisible({ timeout: 60_000 });
    await expect(due).toContainText(/Site check-in today at 23:45/);
    await due.getByRole("link", { name: "Open the check-in" }).click();
    await expect(page.getByTestId(`site-visit-${visit.id}`)).toBeVisible({ timeout: 60_000 });

    // Mark visited — no pass, no fail — is the done action.
    await page.getByTestId(`site-visit-${visit.id}`).getByTestId("site-visit-mark").click();
    await expect(page.getByTestId("site-visit-visited")).toBeVisible({ timeout: 30_000 });
    await page.goto("/pc");
    await expect(page.getByTestId("queue")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId(`site-visit-card-site_visit_due:work_order:${job!.workOrderId}:${visit.id}`)).toHaveCount(0);
  });

  test("none of it reaches an anonymous visitor — the /w token page or the API", async ({ browser }) => {
    const anon = await browser.newContext();
    const page = await anon.newPage();
    const res = await page.goto(`/w/${shareToken}`);
    expect(res?.status()).toBe(200);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/quality check|check-in|calendar invite/i);
    expect(text).not.toContain("10:30");
    await anon.close();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const pub = createClient(url, key, { auth: { persistSession: false } });
    const checks = await pub.from("wo_qa_checks").select("id").eq("work_order_id", job!.workOrderId);
    expect(checks.data ?? []).toEqual([]);
    const events = await pub.from("wo_events").select("id").eq("work_order_id", job!.workOrderId);
    expect(events.data ?? []).toEqual([]);
    const call = await pub.rpc("wo_qa_set_schedule", { p_check_id: checkId, p_date: start, p_time: "09:00" });
    expect(call.error?.code).toBe("42501");
    const add = await pub.rpc("wo_add_qa_check", { p_work_order_id: job!.workOrderId, p_date: start, p_kind: "mid", p_time: "09:00" });
    expect(add.error?.code).toBe("42501");
  });
});
