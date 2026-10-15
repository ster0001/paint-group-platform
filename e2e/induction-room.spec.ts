import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { accessTokenFor, contractorIdForEmail, rpcAs, serviceClient } from "./fixtures/woLoop";

/**
 * The full room — induction brief §8 Step 6.
 *
 * Three new contractors inducted at once by one facilitator: three practice
 * jobs running, three rows on the facilitator's grid, one reset mid-session,
 * one contractor ticking in Farsi while their demo stays English, one worker
 * doing the worker induction on the demo their contractor shared. Then the
 * money story again, after every feature exists: demo variation, invoice,
 * expense, call back and materials request on a demo job change nothing on
 * PC Command, Payments or the status evaluator. Then the customer role reads
 * nothing from any table the build added.
 *
 * Rows: three painters (auth, contractor, invite), one worker login, three
 * demo chains — all removed in afterAll; the two language live flags and
 * nothing else are put back.
 */
const staff = credentials("STAFF");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const DEMO_TITLE = "12 Demo Street";

const run = Date.now().toString(36);
type Painter = { email: string; password: string; name: string; language: "en" | "fa" | "es"; userId: string; contractorId: string; demoWoId: string; demoRef: string };
const painters: Painter[] = (["en", "fa", "es"] as const).map((language, i) => ({
  email: `pg.e2e.room${i + 1}.${run}@example.com`, password: `Room-${run}-${i + 1}-pw!`, name: `Room Painter ${i + 1}`, language,
  userId: "", contractorId: "", demoWoId: "", demoRef: "",
}));
let workerUserId = "";
let workerEmail = "";
let contractorUserId = "";
const liveBefore: Record<string, boolean> = {};

const WORKER_MODULES = ["m02", "m03", "m04", "m06", "m07", "m08", "m09", "m10", "m13"];
const SECTIONS = ["levels", "rules", "time", "interior", "exterior", "defect"] as const;

async function rpcWithToken(token: string, fn: string, args: Record<string, unknown>): Promise<string> {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  return String(await r.json());
}

async function workerToken(): Promise<string> {
  const link = await db!.auth.admin.generateLink({ type: "magiclink", email: workerEmail });
  expect(link.error?.message ?? "").toBe("");
  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const v = await anon.auth.verifyOtp({ type: "email", token_hash: link.data.properties!.hashed_token });
  expect(v.error?.message ?? "").toBe("");
  return v.data.session!.access_token;
}

async function removeDemo(cid: string) {
  const { data } = await db!.from("work_orders").select("id, estimate_id").eq("contractor_id", cid).eq("is_demo", true);
  for (const wo of (data ?? []) as { id: string; estimate_id: string }[]) {
    for (const t of ["timesheet_entries", "contractor_invoices", "job_costs", "contractor_expenses", "expense_preapprovals", "material_costs"]) {
      const r = await db!.from(t).delete().eq("work_order_id", wo.id).eq("is_demo", true);
      expect(r.error?.message ?? "", `${t} cleanup`).toBe("");
    }
    await db!.from("invoices").delete().eq("estimate_id", wo.estimate_id).eq("is_demo", true);
    const r = await db!.from("estimates").delete().eq("id", wo.estimate_id).eq("is_demo", true);
    expect(r.error?.message ?? "", "estimate cleanup").toBe("");
  }
}

async function demoOf(cid: string): Promise<{ id: string; wo_ref: string }> {
  const { data, error } = await db!.from("work_orders").select("id, wo_ref").eq("contractor_id", cid).eq("is_demo", true).order("created_at", { ascending: false }).limit(1).single();
  expect(error?.message ?? "").toBe("");
  return data as { id: string; wo_ref: string };
}

async function acceptDemoOffer(p: Painter) {
  const { data: o } = await db!.from("booking_offers").select("id").eq("work_order_id", p.demoWoId).eq("state", "offered").single();
  expect(await rpcAs(p, "respond_to_offer", { p_offer_id: (o as { id: string }).id, p_action: "accept", p_note: "", p_proposed_start: null, p_decline_reason: "" })).toBe("accepted");
}

async function expectNoDemoOn(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("body")).not.toContainText(DEMO_TITLE);
  for (const p of painters) if (p.demoRef) await expect(page.locator("body")).not.toContainText(p.demoRef);
}

test.describe.configure({ mode: "serial" });

test.describe("the full room — three painters, one facilitator, one worker, and the wall", () => {
  test.skip(!staff || !customer, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    for (const code of ["fa", "es"]) {
      const { data } = await db!.from("induction_languages").select("live").eq("code", code).single();
      liveBefore[code] = (data as { live: boolean }).live;
      await db!.from("induction_languages").update({ live: true }).eq("code", code);
    }
    for (const p of painters) {
      const token = await rpcAs(staff!, "create_contractor_invite", { p_email: p.email, p_name: p.name, p_company: `${p.name} Co`, p_tier: null, p_days: 7 });
      expect(token).toMatch(/^[0-9a-f]{48}$/);
      const made = await db!.auth.admin.createUser({ email: p.email, password: p.password, email_confirm: true, user_metadata: { name: p.name } });
      expect(made.error?.message ?? "").toBe("");
      p.userId = made.data.user!.id;
      // The join, as the painter's own session (what the join form does), then the language (Module 1, step 1).
      expect(await rpcAs(p, "redeem_contractor_invite", { p_token: token })).toBe("ok");
      expect(await rpcAs(p, "induction_set_language", { p_code: p.language })).toBe(`ok:${p.language}`);
      p.contractorId = (await contractorIdForEmail(db!, p.email))!;
      await db!.from("contractors").update({ tour_seen_at: new Date().toISOString(), phone: "0400 000 00" + painters.indexOf(p) }).eq("id", p.contractorId);
      // The facilitator sets up 12 Demo Street on each account before the day (facilitator checklist).
      expect(await rpcAs(staff!, "demo_property_seed", { p_contractor_id: p.contractorId })).toMatch(/^ok:/);
      const d = await demoOf(p.contractorId); p.demoWoId = d.id; p.demoRef = d.wo_ref;
    }
  });

  test.afterAll(async () => {
    if (!db) return;
    if (workerUserId) await db.auth.admin.deleteUser(workerUserId);
    for (const p of painters) {
      if (!p.contractorId) continue;
      await removeDemo(p.contractorId);
      await db.from("contractor_documents").delete().eq("contractor_id", p.contractorId);
      await db.from("contractors").delete().eq("id", p.contractorId);
      await db.from("profiles").delete().eq("id", p.userId);
      await db.auth.admin.deleteUser(p.userId);
      await db.from("contractor_invites").delete().eq("email", p.email);
    }
    for (const [code, live] of Object.entries(liveBefore)) await db.from("induction_languages").update({ live }).eq("code", code);
  });

  test("three practice jobs running: three rows on the facilitator's grid, each on its own step", async ({ page }) => {
    for (const p of painters) await acceptDemoOffer(p);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/demo");
    for (const p of painters) {
      await expect(page.getByTestId(`demo-row-${p.contractorId}`)).toBeVisible();
      await expect(page.getByTestId(`demo-step-${p.contractorId}-accept`)).toHaveAttribute("data-done", "true");
      await expect(page.getByTestId(`demo-done-${p.contractorId}`)).toContainText("1");
      await expect(page.getByTestId(`demo-ticks-${p.contractorId}`)).toContainText("0 / 13");
    }
  });

  test("one reset mid-session: that painter's row starts again, the other two do not move", async ({ page }) => {
    const p2 = painters[1];
    const before = p2.demoWoId;
    expect(await rpcAs(p2, "demo_property_reset", { p_contractor_id: null })).toMatch(/^ok:/);
    const d = await demoOf(p2.contractorId); p2.demoWoId = d.id; p2.demoRef = d.wo_ref;
    expect(p2.demoWoId).not.toBe(before);
    const { data: old } = await db!.from("work_orders").select("id").eq("id", before);
    expect(old?.length ?? 0).toBe(0);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/demo");
    await expect(page.getByTestId(`demo-step-${p2.contractorId}-accept`)).toHaveAttribute("data-done", "false");
    await expect(page.getByTestId(`demo-done-${p2.contractorId}`)).toContainText("0");
    for (const p of [painters[0], painters[2]]) await expect(page.getByTestId(`demo-step-${p.contractorId}-accept`)).toHaveAttribute("data-done", "true");
  });

  test("ticking in Farsi while the demo stays English", async ({ page }) => {
    const p2 = painters[1];
    await signIn(page, p2, /\/portal/);
    await page.goto("/portal/induction");
    await expect(page.getByTestId("induction")).toHaveAttribute("data-language", "fa");
    await page.goto("/portal/induction/m03");
    const title = page.getByTestId("induction-module-title");
    await expect(title).toHaveAttribute("lang", "fa");
    await expect(title).toHaveAttribute("dir", "rtl");
    await expect(title).toHaveText(/[؀-ۿ]/);
    await expect(page.getByTestId("induction-line-s1")).toHaveText(/[؀-ۿ]/);
    await expect(page.getByTestId("induction-line-s1")).toHaveAttribute("data-translated", "true");
    await page.getByTestId("induction-tick").click();
    await page.getByTestId("induction-next").click();
    await expect(page.getByTestId("induction-module")).toHaveAttribute("data-module", "m04", { timeout: 20_000 });
    // The chrome is English: the page itself, and the demo job.
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.goto(`/portal/jobs/${p2.demoWoId}`);
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    // Before the (reset) offer is accepted the page shows the suburb only, so the address is
    // not the test: the banner, the scope and the chrome are English; only the finish
    // standards block (§5: translated) may carry Farsi.
    await expect(page.getByTestId("demo-banner")).toContainText("Practice job");
    await expect(page.getByTestId("demo-banner")).not.toHaveText(/[؀-ۿ]/);
    await expect(page.locator("body")).toContainText("Bedroom 1");
    await expect(page.locator("body")).toContainText("Scope of works");
    // The grid counts the tick, in any language.
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/demo");
    await expect(page.getByTestId(`demo-ticks-${p2.contractorId}`)).toContainText("1 / 13");
  });

  test("a worker does the worker induction on the demo their contractor shared, in Spanish; checked, they are inducted", async () => {
    test.setTimeout(120_000);
    const p3 = painters[2];
    const made = await db!.auth.admin.createUser({ email: `worker-room-${run}@workers.paintgroup.com.au`, email_confirm: true, user_metadata: { name: "Room Worker" } });
    expect(made.error?.message ?? "").toBe("");
    workerUserId = made.data.user!.id; workerEmail = made.data.user!.email!;
    await db!.from("profiles").update({ role: "contractor", name: "Room Worker", contact: "+61400111444" }).eq("id", workerUserId);
    const reg = await rpcAs(p3, "worker_register", { p_profile_id: workerUserId, p_name: "Room Worker", p_mobile: "+61400111444", p_contractor_id: null });
    expect(reg).toMatch(/^ok:/);
    contractorUserId = reg.slice(3);
    // The demo can be shared with an un-inducted worker (⚑8): it is their induction.
    expect(await rpcAs(p3, "worker_share", { p_work_order_id: p3.demoWoId, p_contractor_user_id: contractorUserId, p_on: true })).toBe("ok:shared");

    const tok = await workerToken();
    expect(await rpcWithToken(tok, "induction_set_language", { p_code: "es" })).toBe("ok:es");
    const jobs = await fetch(`${URL}/rest/v1/rpc/worker_jobs`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_work_order_id: null }) }).then((r) => r.json()) as { work_order_id: string; is_demo: boolean }[];
    expect(jobs.map((j) => j.work_order_id)).toEqual([p3.demoWoId]);
    expect(jobs[0].is_demo).toBe(true);
    for (const sec of SECTIONS) expect(await rpcWithToken(tok, "induction_ack_module", { p_module_key: "m05", p_section_key: sec })).toMatch(/^ok:/);
    for (const m of WORKER_MODULES) expect(await rpcWithToken(tok, "induction_ack_module", { p_module_key: m, p_section_key: "" }), m).toMatch(m === "m13" ? /^ok:complete$/ : /^ok:\d+\/10$/);
    for (const t of ["open_job", "before_photo", "prepped"]) expect(await rpcAs(staff!, "induction_check_record", { p_profile_id: workerUserId, p_task_key: t, p_result: "pass", p_note: "" })).toMatch(/^ok:/);
    const { data: cu } = await db!.from("contractor_users").select("inducted_at, induction_language").eq("id", contractorUserId).single();
    expect((cu as { inducted_at: string | null; induction_language: string }).inducted_at).not.toBeNull();
    expect((cu as { induction_language: string }).induction_language).toBe("es");
  });

  test("the money story, after every feature exists: nothing demo reaches PC Command, Payments or the evaluator", async ({ page, request }) => {
    test.setTimeout(240_000);
    const p1 = painters[0];
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/invoicing");
    const invoicingBefore = (await page.getByTestId("pm-headline").innerText()).trim();
    const pcCards = async () => { await page.goto("/pc"); return (await page.locator("[data-testid^='gap-card-']").count()); };
    const gapBefore = await pcCards();

    // Every money and attention row the build knows, on a demo job: the copy trigger marks each one.
    const v = await db!.from("wo_variations").insert({ work_order_id: p1.demoWoId, category: "extra_scope", comment: "Room demo extra door", status: "raised", raised_kind: "contractor", est_hours: 1.5 }).select("is_demo").single();
    expect(v.error?.message ?? "").toBe(""); expect((v.data as { is_demo: boolean }).is_demo).toBe(true);
    const ci = await db!.from("contractor_invoices").insert({ work_order_id: p1.demoWoId, contractor_id: p1.contractorId, status: "submitted", claimed_ex_cents: 100_000, gst_cents: 10_000, total_inc_cents: 110_000 }).select("is_demo").single();
    expect(ci.error?.message ?? "").toBe(""); expect((ci.data as { is_demo: boolean }).is_demo).toBe(true);
    const ex = await db!.from("contractor_expenses").insert({ work_order_id: p1.demoWoId, contractor_id: p1.contractorId, category: "parking", amount_cents: 2_000, gst_cents: 182, receipt_path: `receipts/e2e/${p1.demoWoId}.jpg`, status: "submitted" }).select("is_demo").single();
    expect(ex.error?.message ?? "").toBe(""); expect((ex.data as { is_demo: boolean }).is_demo).toBe(true);
    const cb = await db!.from("wo_callbacks").insert({ work_order_id: p1.demoWoId, painter_id: p1.contractorId, source: "customer_call", reason: "workmanship", reported_on: new Date().toISOString().slice(0, 10), description: "Room demo call back", status: "open" }).select("is_demo").single();
    expect(cb.error?.message ?? "").toBe(""); expect((cb.data as { is_demo: boolean }).is_demo).toBe(true);
    const mr = await db!.from("wo_material_requests").insert({ work_order_id: p1.demoWoId, contractor_id: p1.contractorId, item: "Room demo paint", quantity: "10 L", status: "requested" }).select("is_demo").single();
    expect(mr.error?.message ?? "").toBe(""); expect((mr.data as { is_demo: boolean }).is_demo).toBe(true);

    for (const path of ["/pc", "/pc/flow", "/pc/schedule", "/pc/contractors", "/invoicing", "/home", "/contractors"]) await expectNoDemoOn(page, path);
    expect(await pcCards(), "no demo materials card on PC Command").toBe(gapBefore);
    await page.goto("/invoicing");
    expect((await page.getByTestId("pm-headline").innerText()).trim()).toBe(invoicingBefore);

    const res = await request.get("/api/cron/campaign-sweep?only=status", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.ok(), await res.text()).toBe(true);
    for (const p of painters) {
      const { data: results } = await db!.from("painter_job_results").select("id").eq("work_order_id", p.demoWoId);
      expect(results?.length ?? 0, `evaluator wrote nothing for ${p.demoRef}`).toBe(0);
    }
  });

  test("the customer role reads nothing from any table the build added", async () => {
    const token = await accessTokenFor(customer!);
    const read = async (table: string) => fetch(`${URL}/rest/v1/${table}?select=id&limit=5`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
    for (const t of ["induction_acks", "induction_checks", "induction_versions", "induction_modules", "induction_blocks", "standards_strings", "wo_material_requests", "contractor_users", "wo_worker_shares"]) {
      const rows = await read(t);
      expect(Array.isArray(rows) ? rows : [], `customer reads no ${t}`).toEqual([]);
    }
    const langs = await fetch(`${URL}/rest/v1/induction_languages?select=code&limit=5`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
    expect(Array.isArray(langs) ? langs : [], "customer reads no induction_languages").toEqual([]);
    // Nothing demo through any of the painter tables either, as before.
    const demo = await fetch(`${URL}/rest/v1/work_orders?select=id&is_demo=eq.true`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
    expect(Array.isArray(demo) ? demo : []).toEqual([]);
  });
});
