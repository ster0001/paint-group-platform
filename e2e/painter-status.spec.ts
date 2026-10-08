import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { accessTokenFor, contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Painter status, Step 5: the evaluator and its one writer.
 *
 * Two signed-off jobs for the E2E contractor — one signed ten days ago (its
 * seven-day window has passed, nothing went wrong, so it is CLEAN), one signed
 * yesterday (still PENDING). The status sweep writes painter_job_results and
 * painter_status; running it again changes nothing. The painter reads their
 * own row and nobody else's; the customer reads none. A Green painter gets no
 * automatic check (R13) but a spot check on demand; an Orange one is checked
 * on every job. The staff table shows the row.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const melb = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

let contractorId = "";
let savedRules: Record<string, unknown> | null = null;
let settled: LoopFixture | null = null;   // signed 10 days ago → clean
let recent: LoopFixture | null = null;    // signed yesterday → pending
let live: LoopFixture | null = null;      // in progress: the cadence + spot check

async function readAs(who: { email: string; password: string }, path: string): Promise<unknown[]> {
  const token = await accessTokenFor(who);
  const body = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
  expect(Array.isArray(body), JSON.stringify(body)).toBe(true);
  return body as unknown[];
}
async function closeSigned(f: LoopFixture, signedAt: Date, start: string, end: string) {
  await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
  await db!.from("work_orders").update({ stage: "closed", status: "complete", start_date: start, end_date: end }).eq("id", f.workOrderId);
  await db!.from("wo_signoff").upsert({ work_order_id: f.workOrderId, signed_at: signedAt.toISOString(), signed_name: "E2E Customer", signed_kind: "in_person", areas: {} }, { onConflict: "work_order_id" });
}
async function sweep(request: Parameters<Parameters<typeof test>[2]>[0]["request"]) {
  const res = await request.get("/api/cron/campaign-sweep?only=status", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json() as Promise<{ status: { ran: number; failed: number } }>;
}
async function statusRow() {
  const { data, error } = await db!.from("painter_status").select("colour, streak, measures, line, computed_at").eq("painter_id", contractorId).maybeSingle();
  expect(error?.message ?? "").toBe("");
  return data as { colour: string; streak: number; measures: Record<string, unknown>; line: string; computed_at: string } | null;
}
async function resultsFor(...ids: string[]) {
  const { data, error } = await db!.from("painter_job_results").select("work_order_id, result, reasons, hours, moments_scored, checks_done").in("work_order_id", ids);
  expect(error?.message ?? "").toBe("");
  return new Map(((data ?? []) as { work_order_id: string; result: string; reasons: string[]; hours: number; moments_scored: number; checks_done: number }[]).map((r) => [r.work_order_id, r]));
}

test.describe.configure({ mode: "serial" });

test.describe("painter status — the evaluator writes, the office reads", () => {
  test.skip(!contractor || !staff || !customer, missingCreds("CUSTOMER"));
  test.skip(!db || !SECRET, "set SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    // ⚑25: nothing signed before the launch date is scored. The launch is today,
    // so a job whose seven days have passed needs the launch moved back for this run.
    const { data: rules, error: rErr } = await db!.from("settings").select("value").eq("key", "painter_status_rules").maybeSingle();
    expect(rErr?.message ?? "").toBe("");
    savedRules = ((rules as { value: Record<string, unknown> } | null)?.value) ?? null;
    expect(savedRules, "painter_status_rules must exist (migration 20270228)").not.toBeNull();
    await db!.from("settings").update({ value: { ...savedRules, launchDate: melb(daysAgo(30)) } }).eq("key", "painter_status_rules");
    settled = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls"] }]);
    await closeSigned(settled, daysAgo(10), melb(daysAgo(13)), melb(daysAgo(11)));
    recent = await createLoopFixture(db!, contractorId, [{ heading: "Hall", labels: ["Walls"] }]);
    await closeSigned(recent, daysAgo(1), melb(daysAgo(3)), melb(daysAgo(2)));
    live = await createLoopFixture(db!, contractorId, [{ heading: "Study", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "in_progress", start_date: melb(new Date()), end_date: melb(daysAgo(-2)) }).eq("id", live.workOrderId);
    await db!.from("wo_qa_checks").delete().eq("work_order_id", live.workOrderId);
  });

  test.afterAll(async () => {
    if (!db) return;
    for (const f of [settled, recent, live]) await destroyLoopFixture(db, f);
    if (savedRules) await db.from("settings").update({ value: savedRules }).eq("key", "painter_status_rules");
    // The shared E2E contractor's status is whatever the next sweep says; leave no trace of this run's colours.
    if (contractorId) await db.from("painter_status").delete().eq("painter_id", contractorId);
  });

  test("the sweep results each signed job and writes one status row; a second run changes nothing", async ({ request }) => {
    test.setTimeout(200_000);
    const first = await sweep(request);
    expect(first.status.failed).toBe(0);
    expect(first.status.ran).toBeGreaterThan(0);

    const results = await resultsFor(settled!.workOrderId, recent!.workOrderId);
    expect(results.get(settled!.workOrderId)?.result).toBe("clean");
    expect(results.get(settled!.workOrderId)?.reasons).toEqual([]);
    expect(results.get(recent!.workOrderId)?.result).toBe("pending");
    expect(results.get(live!.workOrderId)).toBeUndefined();

    const row = await statusRow();
    expect(row).not.toBeNull();
    expect(["new", "green"]).toContain(row!.colour);
    expect(row!.line.length).toBeGreaterThan(0);
    const measures = row!.measures as { checks: { done: number }; reminders: { scored: number }; callbacks: { scored: number } };
    expect(measures.callbacks.scored).toBe(0);

    // Idempotent: the writer diffs; no new events, same computed status.
    const before = await db!.from("contractor_events").select("id", { count: "exact", head: true }).eq("contractor_id", contractorId).in("type", ["job_result_set", "status_changed", "bonus_review_raised"]);
    const second = await sweep(request);
    expect(second.status.failed).toBe(0);
    const after = await db!.from("contractor_events").select("id", { count: "exact", head: true }).eq("contractor_id", contractorId).in("type", ["job_result_set", "status_changed", "bonus_review_raised"]);
    expect(after.count).toBe(before.count);
    expect((await statusRow())!.colour).toBe(row!.colour);
  });

  test("RLS — the painter reads their own row only; the customer reads none; nobody writes but the RPC", async () => {
    const mine = await readAs(contractor!, "painter_status?select=painter_id,colour");
    expect(mine.length).toBe(1);
    expect((mine[0] as { painter_id: string }).painter_id).toBe(contractorId);
    const myResults = await readAs(contractor!, "painter_job_results?select=work_order_id,result");
    expect(myResults.length).toBeGreaterThanOrEqual(2);
    expect(await readAs(customer!, "painter_status?select=painter_id")).toEqual([]);
    expect(await readAs(customer!, "painter_job_results?select=work_order_id")).toEqual([]);
    expect(await readAs(contractor!, "painter_bonuses?select=id")).toEqual([]);
    // The writer refuses a painter.
    expect(await rpcAs(contractor!, "painter_status_write", { p_painter_id: contractorId, p_results: [], p_status: { colour: "green", streak: 9, best_streak: 9, measures: {}, bonus_counter: 0, line: "x" }, p_bonus_reviews: [] })).toMatch(/^error:not_staff/);
  });

  test("QA cadence follows the colour: Green = no automatic check, spot check on demand; Orange = every job", async () => {
    await db!.from("painter_status").update({ colour: "green" }).eq("painter_id", contractorId);
    expect(await rpcAs(staff!, "wo_schedule_qa", { p_work_order_id: live!.workOrderId })).toBe("ok:0");

    // R13: the office checks a Green painter when it chooses.
    expect(await rpcAs(contractor!, "wo_add_qa_check", { p_work_order_id: live!.workOrderId, p_date: null, p_kind: "spot" })).toBe("error:not_staff");
    expect(await rpcAs(staff!, "wo_add_qa_check", { p_work_order_id: live!.workOrderId, p_date: null, p_kind: "fancy" })).toBe("error:bad_kind");
    const spot = await rpcAs(staff!, "wo_add_qa_check", { p_work_order_id: live!.workOrderId, p_date: null, p_kind: "spot" });
    expect(spot).toMatch(/^ok:/);
    const { data: checks } = await db!.from("wo_qa_checks").select("kind, trigger").eq("work_order_id", live!.workOrderId);
    expect(checks).toEqual([{ kind: "spot", trigger: "spot" }]);
    await db!.from("wo_qa_checks").delete().eq("work_order_id", live!.workOrderId);

    await db!.from("painter_status").update({ colour: "orange" }).eq("painter_id", contractorId);
    const made = await rpcAs(staff!, "wo_schedule_qa", { p_work_order_id: live!.workOrderId });
    expect(made).toMatch(/^ok:[1-9]/);
    const { data: orange } = await db!.from("wo_qa_checks").select("trigger").eq("work_order_id", live!.workOrderId);
    expect((orange ?? []).every((c) => (c as { trigger: string }).trigger === "orange_every")).toBe(true);
  });

  test("the staff table shows the row; the painter cannot open it", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/contractors");
    await expect(page.getByTestId("painter-status")).toBeVisible();
    const row = page.getByTestId(`painter-status-row-${contractorId}`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-colour", "orange");
    await expect(row).toContainText(/Checks/);
  });
});
