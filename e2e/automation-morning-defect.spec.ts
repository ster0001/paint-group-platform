import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 8 Oct 2026 — two texts, driven through the real half-hour sweep route.
 *
 *   contractor_job_update_morning — on a day with a 3:30 pm update moment the
 *   painter is also told in the morning that today is an update day: a
 *   three-day job booked yesterday → tomorrow has its half-way moment today,
 *   so the sweep texts the painter once, records the dispatcher's outcome on
 *   the job, never twice, and not at all once the day's update is in.
 *
 *   customer_defect_tape — a three-day job booked today → +2 days: two working
 *   days before the last day is today, so the customer is asked to mark any
 *   touch-ups with the painter's tape — a morning text, then an afternoon one
 *   in its own wording, each once, the outcome on the job. A customer who
 *   switched off job texts is recorded as suppressed, never texted.
 *
 * The send times are Settings rows (job_update_rules, defect_tape_rules); the
 * spec opens the windows around "now" and restores them, and opens the
 * office's sending hours for the defect text (it is not exempt from them) so
 * the run does not depend on the clock. There is no customer screen here — the
 * text is the whole feature — so the assertions read the job's own record.
 */
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";
const HEADS_UP = "contractor_job_update_morning";
const DEFECT = "customer_defect_tape";

const melb = (plusDays: number) =>
  new Date(Date.now() + plusDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });

type SettingsBefore = { key: string; value: unknown | null };
const settingsBefore: SettingsBefore[] = [];
let painterJob: LoopFixture | null = null;
let customerJob: LoopFixture | null = null;
let contractorId = "";
let contractorBefore: { phone: string | null; works_saturday: boolean | null; works_sunday: boolean | null } | null = null;
let accountId = "";

async function setSetting(key: string, value: Record<string, unknown>, merge = false) {
  if (!settingsBefore.some((s) => s.key === key)) {
    const { data, error } = await db!.from("settings").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    settingsBefore.push({ key, value: data ? (data as { value: unknown }).value : null });
  }
  const prev = settingsBefore.find((s) => s.key === key)!.value;
  const next = merge && prev && typeof prev === "object" ? { ...(prev as Record<string, unknown>), ...value } : value;
  const { error } = await db!.from("settings").upsert({ key, value: next }, { onConflict: "key" });
  if (error) throw error;
}

const cleanup = async () => {
  if (!db || process.env.E2E_KEEP) return;
  for (const f of [painterJob, customerJob]) {
    if (!f) continue;
    await db.from("automation_holds").delete().eq("work_order_id", f.workOrderId);
    await db.from("messages").delete().eq("work_order_id", f.workOrderId);
    await db.from("automation_claims").delete().eq("entity_id", f.workOrderId);
  }
  for (const s of settingsBefore) {
    if (s.value === null) await db.from("settings").delete().eq("key", s.key);
    else await db.from("settings").upsert({ key: s.key, value: s.value }, { onConflict: "key" });
  }
  if (contractorId && contractorBefore) await db.from("contractors").update(contractorBefore).eq("id", contractorId);
  await destroyLoopFixture(db, painterJob);
  await destroyLoopFixture(db, customerJob);
  if (accountId) await db.from("accounts").delete().eq("id", accountId);
};

test.describe("morning heads-up to the painter + defect-tape text to the customer", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!db || !SECRET, "set SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    expect(contractorId, "the E2E contractor needs a contractors row").toBeTruthy();
    const { data: c, error: cErr } = await db!.from("contractors").select("phone, works_saturday, works_sunday").eq("id", contractorId).single();
    if (cErr) throw cErr;
    contractorBefore = c as typeof contractorBefore;
    // Works every day for the run, so "yesterday → tomorrow" is three booked days whatever the weekday.
    const { error } = await db!.from("contractors")
      .update({ phone: contractorBefore?.phone || "0400 000 000", works_saturday: true, works_sunday: true }).eq("id", contractorId);
    if (error) throw error;

    await setSetting("job_update_rules", { headsUp: "00:01", headsUpUntil: "23:59" }, true);
    // The morning window open all day; the afternoon one shut until the test opens it.
    await setSetting("defect_tape_rules", { morning: "00:01", morningUntil: "23:59", afternoon: "23:59", afternoonUntil: "23:59" });
    await setSetting("messaging", { quietHours: { weekday: [0, 24], saturday: [0, 24], sunday: [0, 24] }, dailyCap: 50 }, true);

    painterJob = await createLoopFixture(db!, contractorId, [{ heading: "Living", labels: ["Walls"] }]);
    const p = await db!.from("work_orders").update({ start_date: melb(-1), end_date: melb(1), stage: "in_progress" }).eq("id", painterJob.workOrderId);
    if (p.error) throw p.error;

    const stamp = Date.now().toString(36);
    const acct = await db!.from("accounts").insert({ email: `erin.${stamp}@defect-tape.invalid`, name: "Defect Tape E2E" }).select("id").single();
    if (acct.error) throw acct.error;
    accountId = (acct.data as { id: string }).id;
    customerJob = await createLoopFixture(db!, contractorId, [{ heading: "Hall", labels: ["Walls"] }]);
    const est = await db!.from("estimates").update({
      account_id: accountId, accepted_name: "Erin Defect",
      sent_snapshot: { jobAddress: "1 Test St, Thornbury VIC 3071", contactEmail: `erin.${stamp}@defect-tape.invalid` },
      builder_state: { contact: { first_name: "Erin", email: `erin.${stamp}@defect-tape.invalid`, phone: "0400000000" } },
    }).eq("id", customerJob.estimateId);
    if (est.error) throw est.error;
    const w = await db!.from("work_orders").update({ start_date: melb(0), end_date: melb(2), stage: "in_progress" }).eq("id", customerJob.workOrderId);
    if (w.error) throw w.error;
  });
  test.afterAll(cleanup);

  const sweep = async (request: Parameters<Parameters<typeof test>[2]>[0]["request"], only: "moments" | "defect") => {
    const res = await request.get(`/api/cron/campaign-sweep?only=${only}`, { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.ok()).toBe(true);
    return (await res.json()) as { jobReminders: { headsUp: number } | null; defectTape: { due: number; dispatched: number } | null };
  };
  const events = async (workOrderId: string, type: string) => {
    const { data, error } = await db!.from("wo_events").select("meta, created_at").eq("work_order_id", workOrderId).eq("type", type).order("created_at");
    if (error) throw error;
    return (data ?? []) as { meta: Record<string, unknown> }[];
  };
  const sends = async (workOrderId: string, key: string) => {
    const [{ data: msgs, error: mErr }, { data: holds, error: hErr }] = await Promise.all([
      db!.from("messages").select("body, status").eq("work_order_id", workOrderId).filter("meta->>automation", "eq", key).order("occurred_at"),
      db!.from("automation_holds").select("sms_body, status").eq("work_order_id", workOrderId).eq("automation_key", key),
    ]);
    if (mErr) throw mErr;
    if (hErr) throw hErr;
    return { msgs: (msgs ?? []) as { body: string; status: string }[], holds: (holds ?? []) as { sms_body: string | null }[] };
  };

  test("the painter gets the morning heads-up on today's 3:30 day — once, with the outcome recorded", async ({ request }) => {
    const first = await sweep(request, "moments");
    expect(first.jobReminders?.headsUp ?? 0).toBeGreaterThanOrEqual(1);
    const ev = await events(painterJob!.workOrderId, "reminder_morning_sent");
    expect(ev).toHaveLength(1);
    expect(ev[0].meta).toMatchObject({ for_kind: "mid", day: melb(0) });
    const outcome = (ev[0].meta.outcomes as Record<string, string>)[contractorId];
    expect(["sent", "not_configured", "failed", "pending", "held"]).toContain(outcome);
    const s = await sends(painterJob!.workOrderId, HEADS_UP);
    expect(s.msgs.length + s.holds.length).toBe(1);
    const body = s.msgs[0]?.body ?? s.holds[0]?.sms_body ?? "";
    expect(body).toMatch(/update day/i);
    expect(body).toMatch(/day 2 of 3/);
    expect(body).toContain(`/portal/jobs/${painterJob!.workOrderId}`);

    await sweep(request, "moments");
    expect(await events(painterJob!.workOrderId, "reminder_morning_sent")).toHaveLength(1);
  });

  test("not sent once the day's update is in", async ({ request }) => {
    await db!.from("automation_claims").delete().eq("automation_key", HEADS_UP).eq("entity_id", painterJob!.workOrderId);
    // The painter's photo lands (the event wo_record_photo writes) and answers today's moment.
    const { error } = await db!.from("wo_events").insert({ work_order_id: painterJob!.workOrderId, type: "photo", actor_kind: "contractor", meta: { kind: "progress", e2e: true } });
    if (error) throw error;
    await sweep(request, "moments");
    expect(await events(painterJob!.workOrderId, "reminder_morning_sent")).toHaveLength(1);
  });

  test("the customer is asked to mark touch-ups with tape: morning, then afternoon, each once", async ({ request }) => {
    const am = await sweep(request, "defect");
    expect(am.defectTape?.dispatched ?? 0).toBeGreaterThanOrEqual(1);
    let ev = await events(customerJob!.workOrderId, "defect_tape_sent");
    expect(ev).toHaveLength(1);
    expect(ev[0].meta).toMatchObject({ rung: "am", day: melb(0) });
    expect(["sent", "not_configured", "failed", "pending"]).toContain(ev[0].meta.outcome);
    let s = await sends(customerJob!.workOrderId, DEFECT);
    expect(s.msgs.length + s.holds.length).toBe(1);
    const first = s.msgs[0]?.body ?? s.holds[0]?.sms_body ?? "";
    expect(first).toMatch(/Hi Erin/);
    expect(first).toMatch(/painter's tape/);
    expect(first).toMatch(/Thornbury/);
    // Never the painter's job on the same day: a job whose defect day is not today gets nothing.
    expect(await events(painterJob!.workOrderId, "defect_tape_sent")).toHaveLength(0);

    await sweep(request, "defect");
    expect(await events(customerJob!.workOrderId, "defect_tape_sent")).toHaveLength(1);

    // The afternoon window opens: the second text, in its own words, once.
    await setSetting("defect_tape_rules", { morning: "00:01", morningUntil: "23:59", afternoon: "00:02", afternoonUntil: "23:59" });
    await sweep(request, "defect");
    await sweep(request, "defect");
    ev = await events(customerJob!.workOrderId, "defect_tape_sent");
    expect(ev.map((e) => e.meta.rung)).toEqual(["am", "pm"]);
    s = await sends(customerJob!.workOrderId, DEFECT);
    expect(s.msgs.length + s.holds.length).toBe(2);
    if (s.msgs.length === 2) expect(s.msgs[1].body).toMatch(/quick reminder/i);
  });

  test("a customer who switched off job texts is recorded as suppressed, not texted", async ({ request }) => {
    await db!.from("automation_claims").delete().eq("automation_key", DEFECT).eq("entity_id", customerJob!.workOrderId);
    await db!.from("messages").delete().eq("work_order_id", customerJob!.workOrderId);
    await db!.from("automation_holds").delete().eq("work_order_id", customerJob!.workOrderId);
    const { error } = await db!.from("accounts").update({ notify_prefs: { job: { sms: false } } }).eq("id", accountId);
    if (error) throw error;
    await setSetting("defect_tape_rules", { morning: "00:01", morningUntil: "23:59", afternoon: "23:59", afternoonUntil: "23:59" });
    await sweep(request, "defect");
    const ev = await events(customerJob!.workOrderId, "defect_tape_sent");
    expect(ev).toHaveLength(3);
    const last = ev[ev.length - 1].meta;
    expect(last.rung).toBe("am");
    // The office may have set this automation to "approves first" on the test project; then it waits in the queue instead.
    if (last.outcome !== "pending") {
      expect(last.outcome).toBe("suppressed");
      const s = await sends(customerJob!.workOrderId, DEFECT);
      expect(s.msgs.map((m) => m.status)).toEqual(["suppressed"]);
    }
  });
});
