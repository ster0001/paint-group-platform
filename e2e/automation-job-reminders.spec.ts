import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 25 Sep 2026 — `contractor_job_update_reminder`, driven through the real
 * half-hour sweep route; Step 4 of the standards / status / call backs brief
 * gave each moment a row, follow-up texts and "No work today".
 *
 *   a two-day job booked yesterday→today → the sweep plans its moments; the
 *   due one texts the painter once (text 1) · the next sweep, with the
 *   follow-up slot passed, texts again (text 2, the second wording) · an app
 *   update (a photo event) answers the moment and NO further text goes ·
 *   never more than three · a day the PC marks No work is skipped, texts or
 *   not · a closed job is not reminded. AS THE PAINTER: the job page lists the
 *   moments and their state. AS PC: the job page's card, and Clear.
 *
 * The follow-up times are a Settings value (job_update_rules); the spec sets
 * them to the start of the day so a slot is always "passed", and restores
 * them. The fixture painter works weekends for the duration so "yesterday and
 * today" are two booked days; both that and their phone are restored.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";
const KEY = "contractor_job_update_reminder";

let f: LoopFixture | null = null;
let contractorId = "";
let before: { phone: string | null; works_saturday: boolean | null; works_sunday: boolean | null } | null = null;
let rulesBefore: unknown = undefined;

const melb = (plusDays: number) =>
  new Date(Date.now() + plusDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });

const cleanup = async () => {
  if (!db || process.env.E2E_KEEP) return;
  if (f) {
    await db.from("automation_holds").delete().eq("work_order_id", f.workOrderId);
    await db.from("messages").delete().eq("work_order_id", f.workOrderId);
  }
  if (contractorId && before) await db.from("contractors").update(before).eq("id", contractorId);
  if (rulesBefore === null) await db.from("settings").delete().eq("key", "job_update_rules");
  else if (rulesBefore !== undefined) await db.from("settings").upsert({ key: "job_update_rules", value: rulesBefore }, { onConflict: "key" });
  if (f) await destroyLoopFixture(db, f);
};

test.describe("update-your-work-order texts to the painter", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db || !SECRET, "set SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    expect(contractorId, "the E2E contractor needs a contractors row").toBeTruthy();
    const { data: c, error: cErr } = await db!.from("contractors").select("phone, works_saturday, works_sunday").eq("id", contractorId).single();
    if (cErr) throw cErr;
    before = c as typeof before;
    const { error } = await db!.from("contractors")
      .update({ phone: before?.phone || "0400 000 000", works_saturday: true, works_sunday: true }).eq("id", contractorId);
    if (error) throw error;
    // Follow-ups at the start of the day: every slot has passed whenever this runs.
    const { data: r } = await db!.from("settings").select("value").eq("key", "job_update_rules").maybeSingle();
    rulesBefore = r ? (r as { value: unknown }).value : null;
    await db!.from("settings").upsert({ key: "job_update_rules", value: { morningFollowUps: ["00:01", "00:02"], afternoonFollowUps: ["00:01", "00:02"], lastSend: "23:59", maxTexts: 3 } }, { onConflict: "key" });

    f = await createLoopFixture(db!, contractorId, [{ heading: "Living", labels: ["Walls"] }]);
    // Booked yesterday → today, under way.
    const { error: wErr } = await db!.from("work_orders")
      .update({ start_date: melb(-1), end_date: melb(0), stage: "in_progress" }).eq("id", f.workOrderId);
    if (wErr) throw wErr;
  });
  test.afterAll(cleanup);

  const sweep = async (request: Parameters<Parameters<typeof test>[2]>[0]["request"]) => {
    const res = await request.get("/api/cron/campaign-sweep?only=moments", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.ok()).toBe(true);
    return (await res.json()) as { jobReminders: { fired: number; followUps: number; stopped: number; painters: number; planned: number } };
  };
  const moments = async () => {
    const { data, error } = await db!.from("wo_reminder_moments").select("id, kind, day, due_at, sends_count, answered_at, skipped_reason").eq("work_order_id", f!.workOrderId).order("due_at");
    if (error) throw error;
    return (data ?? []) as { id: string; kind: string; day: string; due_at: string; sends_count: number; answered_at: string | null; skipped_reason: string | null }[];
  };
  const texts = async () => {
    const [{ data: msgs, error: mErr }, { data: holds, error: hErr }] = await Promise.all([
      db!.from("messages").select("id, body").eq("work_order_id", f!.workOrderId).filter("meta->>automation", "eq", KEY),
      db!.from("automation_holds").select("id").eq("work_order_id", f!.workOrderId).eq("automation_key", KEY),
    ]);
    if (mErr) throw mErr;
    if (hErr) throw hErr;
    return { msgs: (msgs ?? []) as { body: string }[], holds: holds ?? [] };
  };

  test("the sweep plans the job's moments; yesterday's untexted one is not a miss; today's texts once, then once more at the follow-up", async ({ request }) => {
    const planned = await sweep(request);
    expect(planned.jobReminders.planned).toBeGreaterThanOrEqual(2);
    let ms = await moments();
    expect(ms.map((m) => m.kind)).toEqual(["day1", "day2"]);
    // Yesterday 07:30 went by with no text: skipped as not_sent, never counted.
    expect(ms[0]).toMatchObject({ day: melb(-1), sends_count: 0, skipped_reason: "not_sent" });
    // Today's 15:30 moment: make it due now whatever the clock says — and
    // untexted, because after 3:30 pm the planning sweep above will already
    // have sent text 1 the moment it created the row.
    await db!.from("messages").delete().eq("work_order_id", f!.workOrderId);
    await db!.from("automation_holds").delete().eq("work_order_id", f!.workOrderId);
    await db!.from("wo_reminder_moments").update({ due_at: new Date(Date.now() - 3_600_000).toISOString(), sends_count: 0, last_sent_at: null }).eq("id", ms[1].id);

    const first = await sweep(request);
    expect(first.jobReminders.fired).toBe(1);
    ms = await moments();
    expect(ms[1].sends_count).toBe(1);
    let t = await texts();
    expect(t.msgs.length + t.holds.length).toBe(1);
    if (t.msgs.length) {
      expect(t.msgs[0].body).toMatch(/update your work order/i);
      expect(t.msgs[0].body).toMatch(/day 2 of 2/);
      expect(t.msgs[0].body).toContain(`/portal/jobs/${f!.workOrderId}`);
    }

    // The follow-up slot (00:02 today) has passed: text 2, in its own words.
    const second = await sweep(request);
    expect(second.jobReminders.followUps).toBe(1);
    ms = await moments();
    expect(ms[1].sends_count).toBe(2);
    t = await texts();
    expect(t.msgs.length + t.holds.length).toBe(2);
    if (t.msgs.length === 2) expect(t.msgs.some((m) => /please update your job in the app today/i.test(m.body))).toBe(true);
  });

  test("an app update answers the moment and nothing more goes; never more than three", async ({ request }) => {
    // The painter's photo lands on the job (the event wo_record_photo writes).
    const { error } = await db!.from("wo_events").insert({ work_order_id: f!.workOrderId, type: "photo", actor_kind: "contractor", meta: { kind: "progress", e2e: true } });
    if (error) throw error;
    let ms = await moments();
    expect(ms[1].answered_at).not.toBeNull();
    const again = await sweep(request);
    expect(again.jobReminders.fired + again.jobReminders.followUps).toBe(0);
    ms = await moments();
    expect(ms[1].sends_count).toBe(2);
    const { data: ev } = await db!.from("wo_events").select("type").eq("work_order_id", f!.workOrderId).eq("type", "reminder_moment_answered");
    expect(ev).toHaveLength(1);

    // Never more than three: a moment already at three texts gets no fourth.
    await db!.from("wo_reminder_moments").update({ day: melb(0), due_at: new Date(Date.now() - 3_600_000).toISOString(), skipped_reason: null, skipped_at: null, sends_count: 3 }).eq("id", ms[0].id);
    const capped = await sweep(request);
    expect(capped.jobReminders.fired + capped.jobReminders.followUps).toBe(0);
    expect((await moments()).find((m) => m.id === ms[0].id)!.sends_count).toBe(3);
  });

  test("No work today: the day's moments are skipped, texts sent or not, and the painter and the PC see the states", async ({ request, page }) => {
    const r = String(await rpcAs(staff!, "wo_set_no_work_day", { p_work_order_id: f!.workOrderId, p_day: melb(0), p_reason: "Rained off" }));
    expect(r).toBe("ok:2");
    const ms = await moments();
    expect(ms.every((m) => m.skipped_reason === "no_work")).toBe(true);
    const none = await sweep(request);
    expect(none.jobReminders.fired + none.jobReminders.followUps).toBe(0);
    // Tomorrow is not known yet.
    expect(await rpcAs(staff!, "wo_set_no_work_day", { p_work_order_id: f!.workOrderId, p_day: melb(1), p_reason: "" })).toBe("error:future_day");

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${f!.workOrderId}`);
    await expect(page.getByTestId("update-moments")).toBeVisible();
    await expect(page.getByTestId("moment-day2")).toHaveAttribute("data-state", "skipped");
    await expect(page.getByTestId("moment-day2")).toContainText("No work that day");

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    await expect(page.getByTestId("reminder-moments")).toBeVisible();
    await expect(page.getByTestId("no-work-days")).toContainText("Rained off");
    await page.getByTestId(`no-work-clear-${melb(0)}`).click();
    await expect(page.getByTestId("no-work-msg")).toContainText(/counts again/);
    const back = await moments();
    expect(back.every((m) => m.skipped_reason === null)).toBe(true);
    expect(back.find((m) => m.kind === "day2")!.answered_at).not.toBeNull();
  });

  test("a job that has moved on is not reminded", async ({ request }) => {
    await db!.from("wo_reminder_moments").update({ answered_at: null, sends_count: 0, skipped_reason: null }).eq("work_order_id", f!.workOrderId);
    const { error } = await db!.from("work_orders").update({ stage: "closed" }).eq("id", f!.workOrderId);
    if (error) throw error;
    const res = await sweep(request);
    expect(res.jobReminders.fired + res.jobReminders.followUps).toBe(0);
    const t = await texts();
    expect(t.msgs.length + t.holds.length).toBe(2);
  });
});
