import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { painterFinishReminderDay } from "@/lib/workorder/jobRhythm";
import { melbourneDate } from "@/lib/workorder/console";

/**
 * Tom, 19 Oct 2026 — `contractor_finish_reminder`, driven through the real
 * half-hour sweep route: "a reminder text message 2 business days before the
 * job is completed reminding of the final walk through date and to change in
 * the app if they are running behind or ahead of schedule."
 *
 *   a job under way whose booked last day is two business days from today →
 *   the sweep texts the contractor once, naming the date and the app link ·
 *   the next sweep sends nothing more · the last day moved → nothing today
 *   (the new date gets its own text in its turn) · a closed job is not texted.
 *
 * The window is a Settings value (finish_reminder_rules); the spec opens it
 * for the whole day so the run does not depend on the clock, and restores it.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";
const KEY = "contractor_finish_reminder";

let f: LoopFixture | null = null;
let contractorId = "";
let phoneBefore: string | null | undefined = undefined;
let rulesBefore: unknown = undefined;
let holidays = new Set<string>();

const two = (n: number) => String(n).padStart(2, "0");
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
};
const today = melbourneDate(new Date());
/** The first day whose reminder day is today — two business days on. */
const walkthroughDay = (): string => {
  for (let n = 1; n <= 14; n++) {
    const d = addDays(today, n);
    if (painterFinishReminderDay(d, holidays) === today) return d;
  }
  throw new Error("no walkthrough day two business days from today within a fortnight");
};

const cleanup = async () => {
  if (!db || process.env.E2E_KEEP) return;
  if (f) {
    await db.from("automation_holds").delete().eq("work_order_id", f.workOrderId);
    await db.from("messages").delete().eq("work_order_id", f.workOrderId);
    await db.from("automation_claims").delete().eq("automation_key", KEY).eq("entity_id", f.workOrderId);
  }
  if (contractorId && phoneBefore !== undefined) await db.from("contractors").update({ phone: phoneBefore }).eq("id", contractorId);
  if (rulesBefore === null) await db.from("settings").delete().eq("key", "finish_reminder_rules");
  else if (rulesBefore !== undefined) await db.from("settings").upsert({ key: "finish_reminder_rules", value: rulesBefore }, { onConflict: "key" });
  if (f) await destroyLoopFixture(db, f);
};

test.describe("the painter's final-walkthrough-date text, two business days out", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db || !SECRET, "set SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    expect(contractorId, "the E2E contractor needs a contractors row").toBeTruthy();
    const { data: c, error: cErr } = await db!.from("contractors").select("phone").eq("id", contractorId).single();
    if (cErr) throw cErr;
    phoneBefore = (c as { phone: string | null }).phone;
    const { error } = await db!.from("contractors").update({ phone: phoneBefore || "0400 000 000" }).eq("id", contractorId);
    if (error) throw error;
    const { data: r } = await db!.from("settings").select("value").eq("key", "finish_reminder_rules").maybeSingle();
    rulesBefore = r ? (r as { value: unknown }).value : null;
    await db!.from("settings").upsert({ key: "finish_reminder_rules", value: { from: "00:00", until: "23:59" } }, { onConflict: "key" });
    const { data: b } = await db!.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
    holidays = new Set(((b as { value?: { publicHolidays?: string[] } } | null)?.value?.publicHolidays ?? []));

    f = await createLoopFixture(db!, contractorId, [{ heading: "Living", labels: ["Walls"] }]);
    const { error: wErr } = await db!.from("work_orders")
      .update({ start_date: addDays(today, -2), end_date: walkthroughDay(), stage: "in_progress" }).eq("id", f.workOrderId);
    if (wErr) throw wErr;
  });
  test.afterAll(cleanup);

  const sweep = async (request: Parameters<Parameters<typeof test>[2]>[0]["request"]) => {
    const res = await request.get("/api/cron/campaign-sweep?only=finish", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.ok()).toBe(true);
    return (await res.json()) as { finishReminder: { due: number; dispatched: number; stopped: number } };
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

  test("two business days before the walkthrough day the contractor is texted once, with the date and the link", async ({ request }) => {
    const first = await sweep(request);
    expect(first.finishReminder.dispatched).toBeGreaterThanOrEqual(1);
    const t = await texts();
    expect(t.msgs.length + t.holds.length).toBe(1);
    if (t.msgs.length) {
      expect(t.msgs[0].body).toMatch(/final walkthrough/i);
      expect(t.msgs[0].body).toMatch(/ahead or behind/i);
      expect(t.msgs[0].body).toContain(`/portal/jobs/${f!.workOrderId}`);
    }
    const { data: ev } = await db!.from("wo_events").select("meta").eq("work_order_id", f!.workOrderId).eq("type", "finish_reminder_sent");
    expect(ev).toHaveLength(1);

    // Nothing more on the next sweep.
    await sweep(request);
    const again = await texts();
    expect(again.msgs.length + again.holds.length).toBe(1);
  });

  test("a moved last day is not today's text; a closed job is never texted", async ({ request }) => {
    await db!.from("automation_claims").delete().eq("automation_key", KEY).eq("entity_id", f!.workOrderId);
    const { error } = await db!.from("work_orders").update({ end_date: addDays(walkthroughDay(), 7) }).eq("id", f!.workOrderId);
    if (error) throw error;
    await sweep(request);
    expect((await texts()).msgs.length + (await texts()).holds.length).toBe(1);

    const { error: cErr } = await db!.from("work_orders").update({ end_date: walkthroughDay(), stage: "closed" }).eq("id", f!.workOrderId);
    if (cErr) throw cErr;
    await sweep(request);
    expect((await texts()).msgs.length + (await texts()).holds.length).toBe(1);
  });
});
