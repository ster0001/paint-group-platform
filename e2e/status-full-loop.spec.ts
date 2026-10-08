import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { accessTokenFor, contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Step 9 — the full loop, in two stories (brief §10 Step 9).
 *
 * HAPPY: the painter is blocked until they sign the standards → signs the six
 * sections → gets an offer → four clean jobs (reminders answered, checks
 * passed first time, no call back, seven days passed) take them New → Green →
 * their lane is first on the board and a sign-off invoice is due in 3 business
 * days → four more clean 16-hour jobs while Green → one bonus review.
 *
 * FAILURE: a check fails first time (fixed the same day) → Yellow; a flagged
 * walk-through becomes a call back → still Yellow; a customer calls back on
 * day 5 → Orange; a customer calls back on day 9 → outside the window, that
 * job is clean and the colour holds. The colour is checked against §4 at each
 * point, and the customer role reads none of it.
 *
 * Facts are written as rows (the Step 2–7 specs prove each route); the
 * EVALUATOR is run through the real sweep and its answer is what is asserted.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const SECTIONS = ["levels", "rules", "time", "interior", "exterior", "defect"] as const;
const melb = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const dayPlus = (ymd: string, n: number) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

let contractorId = "";
let offerJob: LoopFixture | null = null;
const jobs: LoopFixture[] = [];
let savedRules: Record<string, unknown> | null = null;
let savedCols: Record<string, unknown> | null = null;

type JobOpts = { daysAgo: number; hours?: number; qaFailFirst?: boolean; callbacks?: { source: "walkthrough_fail" | "customer_call"; dayAfter: number }[]; missReminder?: boolean };

/** A finished, signed-off job with its facts as rows. */
async function makeJob(o: JobOpts): Promise<LoopFixture> {
  const f = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls"] }]);
  jobs.push(f);
  const signedOn = melb(daysAgo(o.daysAgo));
  const start = dayPlus(signedOn, -3), end = dayPlus(signedOn, -1);
  const { data: wo } = await db!.from("work_orders").select("wo_snapshot").eq("id", f.workOrderId).single();
  const snap = (wo as { wo_snapshot: { areas: { surfaces: { hours: number }[] }[] } }).wo_snapshot;
  snap.areas[0].surfaces[0].hours = o.hours ?? 20;
  await db!.from("work_orders").update({ stage: "closed", status: "complete", start_date: start, end_date: end, contractor_payment_cents: 100_000, wo_snapshot: snap }).eq("id", f.workOrderId);
  await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
  await db!.from("wo_signoff").upsert({ work_order_id: f.workOrderId, signed_at: `${signedOn}T05:00:00Z`, signed_name: "E2E Customer", signed_kind: "in_person", areas: {} }, { onConflict: "work_order_id" });
  // The quality check: passed first time, or failed first and passed on the re-check the same day.
  const checks = o.qaFailFirst
    ? [{ work_order_id: f.workOrderId, kind: "final", result: "fail", attempt_no: 1, checked_at: `${end}T02:00:00Z`, trigger: "required" }, { work_order_id: f.workOrderId, kind: "final", result: "pass", attempt_no: 2, checked_at: `${end}T06:00:00Z`, trigger: "recheck" }]
    : [{ work_order_id: f.workOrderId, kind: "final", result: "pass", attempt_no: 1, checked_at: `${end}T05:00:00Z`, trigger: "required" }];
  const q = await db!.from("wo_qa_checks").insert(checks);
  expect(q.error?.message ?? "").toBe("");
  // Two reminder moments, texted once each, answered by an update that day.
  const m = await db!.from("wo_reminder_moments").insert([
    { work_order_id: f.workOrderId, kind: "day1", day: start, due_at: `${start}T20:30:00Z`, sends_count: 1, last_sent_at: `${start}T20:30:00Z`, answered_at: `${start}T23:00:00Z` },
    { work_order_id: f.workOrderId, kind: "last", day: end, due_at: `${end}T04:30:00Z`, sends_count: 1, last_sent_at: `${end}T04:30:00Z`, answered_at: o.missReminder ? null : `${end}T05:00:00Z` },
  ]);
  expect(m.error?.message ?? "").toBe("");
  for (const cb of o.callbacks ?? []) {
    const c = await db!.from("wo_callbacks").insert({ work_order_id: f.workOrderId, painter_id: contractorId, source: cb.source, reason: "workmanship", reported_on: dayPlus(signedOn, cb.dayAfter), description: `E2E ${cb.source}`, status: "open" });
    expect(c.error?.message ?? "").toBe("");
  }
  return f;
}
async function evaluate(request: Parameters<Parameters<typeof test>[2]>[0]["request"]) {
  const res = await request.get("/api/cron/campaign-sweep?only=status", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
  expect(res.ok(), await res.text()).toBe(true);
  const { data, error } = await db!.from("painter_status").select("colour, streak, bonus_counter, measures").eq("painter_id", contractorId).single();
  expect(error?.message ?? "").toBe("");
  return data as { colour: string; streak: number; bonus_counter: number; measures: Record<string, { band?: string; scored?: number }> };
}
async function resultOf(f: LoopFixture) {
  const { data } = await db!.from("painter_job_results").select("result, reasons").eq("work_order_id", f.workOrderId).maybeSingle();
  return data as { result: string; reasons: string[] } | null;
}
async function readAs(who: { email: string; password: string }, path: string): Promise<unknown[]> {
  const token = await accessTokenFor(who);
  const body = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
  expect(Array.isArray(body), JSON.stringify(body)).toBe(true);
  return body as unknown[];
}
async function tickAll(page: Page) {
  for (let i = 0; i < 6; i++) {
    await expect(page.getByTestId("signoff-section")).toHaveAttribute("data-section", SECTIONS[i]);
    await page.getByTestId("signoff-tick").click();
    await page.getByTestId("signoff-next").click();
  }
  await expect(page.getByTestId("signoff-done")).toBeVisible({ timeout: 20_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("the full loop — standards → offer → clean jobs → Green → bonus; then the slips", () => {
  test.skip(!contractor || !staff || !customer, missingCreds("CUSTOMER"));
  test.skip(!db || !SECRET, "set SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET");
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    const { data: rules } = await db!.from("settings").select("value").eq("key", "painter_status_rules").maybeSingle();
    savedRules = ((rules as { value: Record<string, unknown> } | null)?.value) ?? null;
    expect(savedRules).not.toBeNull();
    await db!.from("settings").update({ value: { ...savedRules, launchDate: melb(daysAgo(60)), statusVisibleToPainters: true } }).eq("key", "painter_status_rules");
    const { data: cols } = await db!.from("contractors").select("standards_invited_at, standards_grace_until").eq("id", contractorId).single();
    savedCols = (cols as Record<string, unknown>) ?? null;
    // A clean slate: no results, no status, no reviews from other runs.
    await db!.from("painter_bonuses").delete().eq("painter_id", contractorId);
    await db!.from("painter_job_results").delete().eq("painter_id", contractorId);
    await db!.from("painter_status").delete().eq("painter_id", contractorId);
    await db!.from("wo_callbacks").delete().eq("painter_id", contractorId);
    offerJob = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "offered", status: "issued", contractor_id: null }).eq("id", offerJob.workOrderId);
  });

  test.afterAll(async () => {
    if (!db) return;
    const ids = [offerJob, ...jobs].filter(Boolean).map((f) => f!.workOrderId);
    await db.from("contractor_invoices").delete().in("work_order_id", ids);
    await db.from("wo_callbacks").delete().eq("painter_id", contractorId);
    await db.from("painter_bonuses").delete().eq("painter_id", contractorId);
    await db.from("painter_job_results").delete().eq("painter_id", contractorId);
    await db.from("painter_status").delete().eq("painter_id", contractorId);
    for (const f of [offerJob, ...jobs]) await destroyLoopFixture(db, f);
    if (savedCols) await db.from("contractors").update(savedCols).eq("id", contractorId);
    if (savedRules) await db.from("settings").update({ value: savedRules }).eq("key", "painter_status_rules");
  });

  test("happy: blocked until signed → signs → offered → four clean jobs → Green → first lane and 3-business-day terms → four more → bonus review", async ({ page, request }) => {
    test.setTimeout(420_000);
    // Existing painter, invited, grace run out, nothing ticked: no offers.
    await db!.from("standards_acks").delete().eq("contractor_id", contractorId);
    await db!.from("contractors").update({ standards_invited_at: daysAgo(10).toISOString(), standards_grace_until: daysAgo(3).toISOString() }).eq("id", contractorId);
    const offer = { p_work_order_id: offerJob!.workOrderId, p_contractor_id: contractorId, p_start: "2026-12-01", p_end: null, p_note: "" };
    expect(await rpcAs(staff!, "send_offer", offer)).toBe("error:standards_not_signed");

    // The painter signs the six sections on their phone.
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/portal\/standards\/confirm/, { timeout: 30_000 });
    await page.getByTestId("signoff-start").click();
    await tickAll(page);
    expect(await rpcAs(staff!, "standards_status", { p_contractor_id: contractorId })).toBe("confirmed");
    expect(await rpcAs(staff!, "send_offer", offer)).toBe("ok:offered");

    // Three clean jobs: still New, three steps towards Green.
    for (const d of [40, 37, 34]) await makeJob({ daysAgo: d });
    let s = await evaluate(request);
    expect(s.colour).toBe("new");
    expect(s.streak).toBe(3);
    for (const j of jobs) expect((await resultOf(j))?.result).toBe("clean");

    // The fourth clean job: Green (R3, R5).
    await makeJob({ daysAgo: 31 });
    s = await evaluate(request);
    expect(s.colour).toBe("green");
    expect(s.streak).toBe(4);
    expect(s.bonus_counter).toBe(0); // the four that earned Green do not count (⚑9)

    // Green gets: first on the board (⚑7) and a 3-business-day due date at sign-off (⚑14).
    await page.context().clearCookies();
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/schedule");
    await expect(page.getByTestId(`lane-status-${contractorId}`)).toHaveAttribute("data-colour", "green");
    const firstLane = page.locator("[data-testid^='lane-status-']").first();
    await expect(firstLane).toHaveAttribute("data-colour", "green");
    const payJob = await makeJob({ daysAgo: 28 });
    const draft = await db!.rpc("contractor_invoice_draft", { p_work_order_id: payJob.workOrderId });
    expect(String(draft.data)).toMatch(/^ok:/);
    const { data: ci } = await db!.from("contractor_invoices").select("due_on, terms_kind").eq("id", String(draft.data).slice(3)).single();
    const { data: expected } = await db!.rpc("business_days_after", { p_from: melb(daysAgo(28)), p_n: 3 });
    expect((ci as { terms_kind: string }).terms_kind).toBe("green_fast");
    expect((ci as { due_on: string }).due_on).toBe(String(expected));

    // Four clean 16-hour-plus jobs while Green: one bonus review, counter back to zero.
    for (const d of [25, 22, 19]) await makeJob({ daysAgo: d });
    s = await evaluate(request);
    expect(s.colour).toBe("green");
    expect(s.streak).toBe(8);
    const { data: reviews } = await db!.from("painter_bonuses").select("id, status, qualifying_wo_ids, trigger_wo_id").eq("painter_id", contractorId);
    expect(reviews).toHaveLength(1);
    const review = (reviews as { status: string; qualifying_wo_ids: string[] }[])[0];
    expect(review.status).toBe("due");
    expect(review.qualifying_wo_ids).toHaveLength(4);
    expect(s.bonus_counter).toBe(0);
    await page.goto("/pc");
    await expect(page.locator('[data-kind="bonus_due"]')).toHaveCount(1);
  });

  test("failure: a first-time fail → Yellow; a flagged walk-through → Yellow; a day-5 call back → Orange; a day-9 call back is outside the window", async ({ request }) => {
    test.setTimeout(300_000);
    // Job 9: the check fails first time, fixed and passed the same day — not clean (R1: passed FIRST time).
    const j9 = await makeJob({ daysAgo: 16, qaFailFirst: true });
    let s = await evaluate(request);
    expect((await resultOf(j9))?.reasons).toEqual(["Quality check failed first time"]);
    expect(s.colour).toBe("yellow"); // 8 of 9 first-time passes = 89%, no call backs
    expect(s.streak).toBe(0);

    // Job 10: the walk-through flagged an area that needed a return visit — a call back (route 2).
    const j10 = await makeJob({ daysAgo: 14, callbacks: [{ source: "walkthrough_fail", dayAfter: 0 }] });
    s = await evaluate(request);
    expect((await resultOf(j10))?.reasons).toEqual(["A call back for workmanship"]);
    expect(s.colour).toBe("yellow"); // checks 8 of 10 = 80%, 1 call back → still Yellow (R4)

    // Job 11: the customer rings on day 5 — inside the 7-day window.
    const j11 = await makeJob({ daysAgo: 12, callbacks: [{ source: "customer_call", dayAfter: 5 }] });
    s = await evaluate(request);
    expect((await resultOf(j11))?.result).toBe("not_clean");
    expect(s.colour).toBe("orange"); // 2 call backs in the last 10 (R4)
    expect(s.measures.callbacks?.scored).toBe(2);

    // Job 12: the customer rings on day 9 — the window has closed (R6); that job is clean.
    const j12 = await makeJob({ daysAgo: 10, callbacks: [{ source: "customer_call", dayAfter: 9 }] });
    s = await evaluate(request);
    expect((await resultOf(j12))?.result).toBe("clean");
    expect(s.colour).toBe("orange");
    expect(s.measures.callbacks?.scored).toBe(2);

    // The event log alone tells the same story (acceptance: status rebuildable).
    const { data: events } = await db!.from("contractor_events").select("type, detail").eq("contractor_id", contractorId).in("type", ["status_changed", "bonus_review_raised"]).order("created_at");
    const changes = (events as { type: string; detail: { to?: string } }[]).filter((e) => e.type === "status_changed").map((e) => e.detail.to);
    expect(changes).toEqual(["new", "green", "yellow", "orange"]);
    expect((events as { type: string }[]).filter((e) => e.type === "bonus_review_raised")).toHaveLength(1);
  });

  test("the customer role reads none of it", async () => {
    for (const t of ["painter_status", "painter_job_results", "painter_bonuses", "wo_callbacks", "wo_reminder_moments", "wo_day_flags", "standards_acks"]) {
      expect(await readAs(customer!, `${t}?select=*&limit=5`), t).toEqual([]);
    }
  });
});
