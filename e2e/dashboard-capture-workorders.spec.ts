import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs,
  serviceClient, type LoopFixture,
} from "./fixtures/woLoop";
import { scheduleDays } from "../lib/reporting/workedTime";

/**
 * Home dashboard v2 · session 0c — capture on work orders (B3).
 *
 * Driven as the PAINTER (their own login) where the flag decides what they
 * are asked, and through the service client for the facts the triggers
 * write. What it proves:
 *   · an opted-OUT painter's finish never shows the hours question, and the
 *     server refuses an entry for them (`not_asked`);
 *   · an opted-IN painter is asked, pre-filled from the booking, and their
 *     entry lands as source = 'entered';
 *   · the last tick on the job writes `all_surfaces_done` once;
 *   · a grown booking span writes `booking_extended`; a shifted one does not;
 *   · QA checks number their attempts: 1, then +1 after every fail;
 *   · a review is asked for and received, by a person, once per job.
 * Everything made here is removed in afterAll, and the painter's flag is put
 * back the way it was.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFrom = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

test.describe("dashboard 0c · capture on work orders", () => {
  test.skip(!contractor || !staff, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");
  let fixture: LoopFixture | null = null;
  let contractorId = "";
  let offerId = "";
  let flagWas = false;
  const start = daysFrom(-4); const end = daysFrom(1);

  const events = async (type: string) => {
    const r = await db!.from("wo_events").select("id, meta").eq("work_order_id", fixture!.workOrderId).eq("type", type);
    if (r.error) throw new Error(r.error.message);
    return r.data as { id: string; meta: Record<string, unknown> }[];
  };

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email)) ?? "";
    if (!contractorId) throw new Error(`no contractors row for ${contractor!.email}`);
    const flag = await db!.from("contractors").select("capture_worked_hours").eq("id", contractorId).single();
    if (flag.error) throw new Error(flag.error.message);
    flagWas = Boolean((flag.data as { capture_worked_hours: boolean }).capture_worked_hours);
    await db!.from("contractors").update({ capture_worked_hours: false }).eq("id", contractorId);

    fixture = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls", "Trims"] }]);
    const offer = await db!.from("booking_offers").insert({
      work_order_id: fixture.workOrderId, contractor_id: contractorId, state: "accepted",
      start_date: start, end_date: end, hours_allowance: 30, payment_cents: 100000,
      offered_at: new Date().toISOString(), accepted_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }).select("id, booked_end_date").single();
    if (offer.error) throw new Error(offer.error.message);
    offerId = offer.data.id as string;
    expect((offer.data as { booked_end_date: string | null }).booked_end_date).toBe(end);   // frozen at acceptance
    // The photo gates: a before shot and a finished shot on the one elevation.
    const photos = await db!.from("wo_photos").insert([
      { work_order_id: fixture.workOrderId, area: "Front", kind: "before", storage_path: `e2e/${fixture.workOrderId}/before.jpg` },
      { work_order_id: fixture.workOrderId, area: "Front", kind: "completion", storage_path: `e2e/${fixture.workOrderId}/after.jpg` },
    ]);
    if (photos.error) throw new Error(photos.error.message);
  });
  test.afterAll(async () => {
    if (!db) return;
    if (offerId) await db.from("booking_offers").delete().eq("id", offerId);
    await destroyLoopFixture(db, fixture);
    if (contractorId) await db.from("contractors").update({ capture_worked_hours: flagWas }).eq("id", contractorId);
  });

  test("opted out: no question on the finish card, and the server refuses an entry", async ({ page }) => {
    // Tick every surface as the painter — the last one writes all_surfaces_done, once.
    for (const s of fixture!.surfaces) {
      const r = await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: s.id, p_to: "done" });
      expect(r).toBe("ok:done");
    }
    expect(await events("all_surfaces_done")).toHaveLength(1);
    // Un-tick and re-tick: still one row.
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: fixture!.surfaces[1].id, p_to: "todo" })).toBe("ok:todo");
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: fixture!.surfaces[1].id, p_to: "done" })).toBe("ok:done");
    expect(await events("all_surfaces_done")).toHaveLength(1);

    expect(await rpcAs(contractor!, "wo_enter_worked_hours", { p_work_order_id: fixture!.workOrderId, p_days: 2, p_hours: 16 }))
      .toBe("error:not_asked");

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await expect(page.getByTestId("finish-up")).toBeVisible();
    await expect(page.getByTestId("hours-ask")).toHaveCount(0);
  });

  test("opted in: asked at the finish, pre-filled from the booking, and the entry is 'entered'", async ({ page }) => {
    const on = await rpcAs(staff!, "set_contractor_capture_worked_hours", { p_contractor_id: contractorId, p_on: true });
    expect(on).toBe("ok:on");

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    const ask = page.getByTestId("hours-ask");
    await expect(ask).toBeVisible();
    const week = await db!.from("contractors").select("works_saturday, works_sunday").eq("id", contractorId).single();
    const bookedDays = scheduleDays(start, end, {
      worksSaturday: Boolean((week.data as { works_saturday: boolean | null }).works_saturday),
      worksSunday: Boolean((week.data as { works_sunday: boolean | null }).works_sunday),
    });
    await expect(page.getByTestId("hours-days")).toHaveValue(String(bookedDays));
    await expect(page.getByTestId("hours-total")).toHaveValue(String(bookedDays * 8));

    // The finishing-up list is a gate of its own; tick it as the painter first.
    await completePrep(db!, contractor!, fixture!.workOrderId, { rubbish: "yes", equipment: "no" });
    await page.reload();
    await page.getByTestId("hours-days").fill("3");
    await page.getByTestId("hours-total").fill("22.5");
    await page.getByTestId("finish-job").click();
    await expect(page.getByTestId("finish-msg")).toContainText("Nice work", { timeout: 20_000 });

    const row = await db!.from("wo_worked_hours").select("days, hours, source, contractor_id")
      .eq("work_order_id", fixture!.workOrderId).single();
    expect(row.error).toBeNull();
    expect(row.data).toEqual({ days: 3, hours: 22.5, source: "entered", contractor_id: contractorId });
    expect(await events("worked_hours_entered")).toHaveLength(1);
  });

  test("a grown booking is an extension event; a shifted one is not", async () => {
    const grow = await db!.from("booking_offers").update({ end_date: daysFrom(3) }).eq("id", offerId);
    expect(grow.error).toBeNull();
    const ext = await events("booking_extended");
    expect(ext).toHaveLength(1);
    expect(ext[0].meta).toMatchObject({ from_end: end, to_end: daysFrom(3), days_added: 2 });
    // booked_end_date did not move with it.
    const o = await db!.from("booking_offers").select("booked_end_date").eq("id", offerId).single();
    expect((o.data as { booked_end_date: string }).booked_end_date).toBe(end);

    const shift = await db!.from("booking_offers").update({ start_date: daysFrom(-3), end_date: daysFrom(4) }).eq("id", offerId);
    expect(shift.error).toBeNull();
    expect(await events("booking_extended")).toHaveLength(1);
  });

  test("quality checks number their attempts: one, then one more after every fail", async () => {
    const mk = async () => {
      const r = await db!.from("wo_qa_checks").insert({ work_order_id: fixture!.workOrderId, kind: "mid" }).select("id, attempt_no").single();
      if (r.error) throw new Error(r.error.message);
      return r.data as { id: string; attempt_no: number };
    };
    const c1 = await mk();
    expect(c1.attempt_no).toBe(1);
    await db!.from("wo_qa_checks").update({ result: "fail", checked_at: new Date().toISOString() }).eq("id", c1.id);
    const c2 = await mk();
    expect(c2.attempt_no).toBe(2);
    await db!.from("wo_qa_checks").update({ result: "pass", checked_at: new Date().toISOString() }).eq("id", c2.id);
    const c3 = await mk();
    expect(c3.attempt_no).toBe(2);   // one fail before it, the pass does not count
  });

  test("a review is asked for and received, by a person, once per job", async () => {
    expect(await rpcAs(staff!, "wo_review_requested", { p_work_order_id: fixture!.workOrderId, p_via: "staff" })).toBe("ok:requested");
    expect(await rpcAs(contractor!, "wo_review_received", { p_work_order_id: fixture!.workOrderId, p_rating: 5, p_note: "" })).toBe("error:not_staff");
    expect(await rpcAs(staff!, "wo_review_received", { p_work_order_id: fixture!.workOrderId, p_rating: 5, p_note: "" })).toBe("ok:received");
    const r = await db!.from("review_requests").select("sent_at, sent_via, received_at, rating").eq("work_order_id", fixture!.workOrderId);
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(1);
    const row = r.data![0] as { sent_at: string | null; sent_via: string; received_at: string | null; rating: number };
    expect(row.sent_via).toBe("staff");
    expect(row.sent_at).not.toBeNull();
    expect(row.received_at).not.toBeNull();
    expect(row.rating).toBe(5);
    // Asking again does not reset the first ask.
    expect(await rpcAs(staff!, "wo_review_requested", { p_work_order_id: fixture!.workOrderId, p_via: "automation" })).toBe("ok:requested");
    const again = await db!.from("review_requests").select("sent_at, sent_via").eq("work_order_id", fixture!.workOrderId).single();
    expect((again.data as { sent_at: string; sent_via: string })).toEqual({ sent_at: row.sent_at, sent_via: "staff" });
  });

  test("Settings → Contractors shows the flag and flips it", async ({ page }) => {
    const before = await db!.from("contractors").select("capture_worked_hours").eq("id", contractorId).single();
    expect((before.data as { capture_worked_hours: boolean }).capture_worked_hours).toBe(true);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/contractors");
    const btn = page.getByTestId(`worked-hours-${contractorId}`);
    await expect(btn).toHaveText("Asks for hours");
    await btn.click();
    await expect(btn).toHaveText("Hours from schedule", { timeout: 15_000 });
    const flag = await db!.from("contractors").select("capture_worked_hours").eq("id", contractorId).single();
    expect((flag.data as { capture_worked_hours: boolean }).capture_worked_hours).toBe(false);
  });
});
