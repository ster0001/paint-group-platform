import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 25 Sep 2026 — `contractor_job_update_reminder`, driven through the real
 * half-hour sweep route.
 *
 *   a two-day job booked yesterday→today → the due moment (day 1 07:30, or
 *   day 2 15:30 once the afternoon has come) fires ONCE: one claim, one
 *   recorded text to the painter · the same half hour again → nothing new ·
 *   the job closes and a later moment comes due → nothing fires: a finished
 *   job stops being reminded.
 *
 * The fixture painter is made to work weekends for the duration so "yesterday
 * and today" are always two booked days whatever the calendar says; both that
 * flag and their phone are restored in cleanup. Teardown (CLAUDE.md): the
 * claims, holds and messages keyed on the job go with the fixture chain.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";
const KEY = "contractor_job_update_reminder";

let f: LoopFixture | null = null;
let contractorId = "";
let before: { phone: string | null; works_saturday: boolean | null; works_sunday: boolean | null } | null = null;

const melb = (plusDays: number) =>
  new Date(Date.now() + plusDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });

const cleanup = async () => {
  if (!db || process.env.E2E_KEEP) return;
  if (f) {
    await db.from("automation_claims").delete().eq("entity_id", f.workOrderId);
    await db.from("automation_holds").delete().eq("work_order_id", f.workOrderId);
    await db.from("messages").delete().eq("work_order_id", f.workOrderId);
  }
  if (contractorId && before) await db.from("contractors").update(before).eq("id", contractorId);
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

    f = await createLoopFixture(db!, contractorId, [{ heading: "Living", labels: ["Walls"] }]);
    // Booked yesterday → today, under way: day 1's 07:30 moment has passed.
    const { error: wErr } = await db!.from("work_orders")
      .update({ start_date: melb(-1), end_date: melb(0), stage: "in_progress" }).eq("id", f.workOrderId);
    if (wErr) throw wErr;
  });
  test.afterAll(cleanup);

  const sweep = async (request: Parameters<Parameters<typeof test>[2]>[0]["request"]) => {
    const res = await request.get("/api/cron/campaign-sweep?only=reminders", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.ok()).toBe(true);
    return (await res.json()) as { jobReminders: { fired: number; stopped: number; painters: number } };
  };
  const recorded = async () => {
    const [{ data: msgs, error: mErr }, { data: holds, error: hErr }] = await Promise.all([
      db!.from("messages").select("id, body").eq("work_order_id", f!.workOrderId).filter("meta->>automation", "eq", KEY),
      db!.from("automation_holds").select("id").eq("work_order_id", f!.workOrderId).eq("automation_key", KEY),
    ]);
    if (mErr) throw mErr;
    if (hErr) throw hErr;
    return { msgs: msgs ?? [], holds: holds ?? [] };
  };
  const claims = async () => {
    const { data, error } = await db!.from("automation_claims").select("rung").eq("automation_key", KEY).eq("entity_id", f!.workOrderId);
    if (error) throw error;
    return (data ?? []).map((c) => (c as { rung: string }).rung).sort();
  };

  test("the due moment texts the painter once; the same half hour again sends nothing new", async ({ request }) => {
    const first = await sweep(request);
    expect(first.jobReminders.fired).toBe(1);
    expect(first.jobReminders.painters).toBe(1);
    const c1 = await claims();
    expect(c1.length).toBeGreaterThanOrEqual(1);
    expect(c1.some((r) => r === "day1" || r === "day2")).toBe(true);
    const r1 = await recorded();
    expect(r1.msgs.length + r1.holds.length).toBe(1);
    if (r1.msgs.length) {
      const body = String((r1.msgs[0] as { body: string }).body);
      expect(body).toMatch(/update your work order/i);
      expect(body).toMatch(/day [12] of 2/);
      expect(body).toContain(`/portal/jobs/${f!.workOrderId}`);
    }

    const again = await sweep(request);
    expect(again.jobReminders.fired).toBe(0);
    expect(await recorded()).toMatchObject({});
    const r2 = await recorded();
    expect(r2.msgs.length + r2.holds.length).toBe(1);
  });

  test("a job that has moved on is not reminded — the later moment is claimed as stopped, no text", async ({ request }) => {
    // Rebook it as a two-day job that ended two days ago, so every moment is
    // due — and close it. The ladder asks "still needed?" and hears no.
    const { error } = await db!.from("work_orders")
      .update({ start_date: melb(-3), end_date: melb(-2), stage: "closed" }).eq("id", f!.workOrderId);
    if (error) throw error;
    const res = await sweep(request);
    expect(res.jobReminders.fired).toBe(0);
    const r = await recorded();
    expect(r.msgs.length + r.holds.length).toBe(1);
  });
});
