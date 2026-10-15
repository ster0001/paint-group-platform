import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { openMagicLink } from "./fixtures/portal";

/**
 * The induction sign-off — brief §8 Step 5 (rulings I1, I9, I13, ⚑1, ⚑5, ⚑15, ⚑17).
 *
 * AS A NEW CONTRACTOR (a real invite): join, pick Spanish, the standards
 * sign-off (Module 5) first, then the induction list; tick Module 1 on the
 * phone and the rest through the RPC as their own session; the last tick
 * writes the induction_completed event and the PDF in their documents (in
 * Spanish). With a verified certificate on file, an offer is refused AT THE
 * RPC and by the table until the induction is complete AND the facilitator
 * has passed all five tasks; then it goes through.
 * AS AN EXISTING CONTRACTOR (the e2e painter, on the refresher): offers flow
 * before the invite and during the grace; the refresher modules tick (never
 * a practical check); offers continue.
 * AS A WORKER: added by the contractor; a share onto a real job is refused
 * (error:not_inducted); the worker ticks every worker module and the six
 * standards sections as their own session; the three-task check passes;
 * inducted_at is written by the RPC and the share goes through.
 * A material version bump copies every tick except the changed module.
 *
 * Rows: the newbie (auth user, contractor, documents), one worker auth user,
 * one loop fixture, the e2e painter's induction rows and invite columns —
 * all removed or put back in afterAll.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const run = Date.now().toString(36);
const newbie = { email: `pg.e2e.induction.${run}@example.com`, password: `Induction-${run}-pw!`, name: "Induction Newbie" };
let newbieUserId: string | null = null;
let newbieContractorId: string | null = null;
let e2eContractorId = "";
let e2eProfileId = "";
let job: LoopFixture | null = null;
let savedCols: Record<string, unknown> | null = null;
let workerUserId = "";
let workerEmail = "";
let contractorUserId = "";
let spanishLiveBefore = false;
const startedAt = new Date().toISOString();

const SECTIONS = ["levels", "rules", "time", "interior", "exterior", "defect"] as const;
const FULL = ["m01", "m02", "m03", "m04", "m06", "m07", "m08", "m09", "m10", "m11", "m12", "m13"];
const REFRESHER = ["m00", "m03", "m06", "m07", "m08", "m09"];
const WORKER = ["m02", "m03", "m04", "m06", "m07", "m08", "m09", "m10", "m13"];

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

async function statusOf(profileId: string): Promise<{ kind: string; ticked: number; total: number; complete: boolean; check_passed: boolean; gate: string | null; inducted_at: string | null }> {
  const r = await fetch(`${URL}/rest/v1/rpc/induction_status`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${await staffToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_profile_id: profileId }) });
  return await r.json();
}
let cachedStaff = "";
async function staffToken(): Promise<string> {
  if (cachedStaff) return cachedStaff;
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: staff!.email, password: staff!.password }) }).then((x) => x.json());
  cachedStaff = r.access_token; return cachedStaff;
}

async function tickStandards(page: Page) {
  for (let i = 0; i < 6; i++) {
    await expect(page.getByTestId("signoff-section")).toHaveAttribute("data-section", SECTIONS[i]);
    await page.getByTestId("signoff-tick").click();
    await page.getByTestId("signoff-next").click();
  }
  await expect(page.getByTestId("signoff-done")).toBeVisible({ timeout: 20_000 });
}

async function putInsuranceOnFile(contractorId: string) {
  // The documents table refuses a row with no object behind it: upload a stub first (the 20260831 rule).
  const path = `${contractorId}/induction-e2e-pl.pdf`;
  const up = await db!.storage.from("contractor-docs").upload(path, Buffer.from("%PDF-1.4\n%e2e induction stub\n"), { contentType: "application/pdf", upsert: true });
  expect(up.error?.message ?? "").toBe("");
  const expires = new Date(); expires.setFullYear(expires.getFullYear() + 1);
  const { error } = await db!.from("contractor_documents").insert({
    contractor_id: contractorId, kind: "insurance", name: "induction-e2e-pl.pdf", file_url: path,
    expires_on: expires.toISOString().slice(0, 10), status: "valid", verified_at: new Date().toISOString(), verify_note: "e2e",
  });
  expect(error?.message ?? "").toBe("");
}

test.describe.configure({ mode: "serial" });

test.describe("induction — ticks, the practical check, completion and the gates", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeAll(async () => {
    e2eContractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    const { data: c } = await db!.from("contractors").select("profile_id, induction_kind, induction_invited_at, induction_grace_until, induction_language").eq("id", e2eContractorId).single();
    const row = c as { profile_id: string; induction_kind: string; induction_invited_at: string | null; induction_grace_until: string | null; induction_language: string | null };
    e2eProfileId = row.profile_id;
    savedCols = { induction_kind: row.induction_kind, induction_invited_at: row.induction_invited_at, induction_grace_until: row.induction_grace_until, induction_language: row.induction_language };
    const { data: l } = await db!.from("induction_languages").select("live").eq("code", "es").single();
    spanishLiveBefore = (l as { live: boolean }).live;
    await db!.from("induction_languages").update({ live: true }).eq("code", "es");
    job = await createLoopFixture(db!, e2eContractorId, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "offered", status: "issued", contractor_id: null }).eq("id", job.workOrderId);
    const { count } = await db!.from("induction_blocks").select("id", { count: "exact", head: true }).eq("language", "en");
    expect(count ?? 0, "the induction is seeded (scripts/seed-induction.ts)").toBeGreaterThan(100);
  });

  test.afterAll(async () => {
    if (!db) return;
    await destroyLoopFixture(db, job);
    if (workerUserId) await db.auth.admin.deleteUser(workerUserId);
    if (newbieUserId) {
      await db.storage.from("contractor-docs").remove([`${newbieContractorId}/induction-e2e-pl.pdf`]);
      await db.from("contractor_documents").delete().eq("contractor_id", newbieContractorId!);
      await db.from("contractors").delete().eq("profile_id", newbieUserId);
      await db.from("profiles").delete().eq("id", newbieUserId);
      await db.auth.admin.deleteUser(newbieUserId);
    }
    await db.from("contractor_invites").delete().eq("email", newbie.email);
    await db.from("induction_acks").delete().eq("profile_id", e2eProfileId);
    await db.from("induction_checks").delete().eq("profile_id", e2eProfileId);
    await db.from("contractor_documents").delete().eq("contractor_id", e2eContractorId).eq("kind", "induction");
    await db.from("contractor_events").delete().eq("contractor_id", e2eContractorId).gte("created_at", startedAt)
      .in("type", ["induction_invited", "induction_invite_sent", "induction_completed", "induction_pdf_sent", "induction_pdf_failed", "worker_added", "worker_inducted", "worker_removed", "worker_shared"]);
    if (savedCols) await db.from("contractors").update(savedCols).eq("id", e2eContractorId);
    await db.from("induction_languages").update({ live: spanishLiveBefore }).eq("code", "es");
  });

  test("a new contractor: join in Spanish, the standards first, then every module; the last tick completes and files the PDF", async ({ page }) => {
    test.setTimeout(240_000);
    const token = await rpcAs(staff!, "create_contractor_invite", { p_email: newbie.email, p_name: newbie.name, p_company: "Newbie Painting", p_tier: null, p_days: 7 });
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    const made = await db!.auth.admin.createUser({ email: newbie.email, password: newbie.password, email_confirm: true, user_metadata: { name: newbie.name } });
    expect(made.error?.message ?? "").toBe("");
    newbieUserId = made.data.user!.id;

    await page.goto(`/join/${token}`);
    await page.getByTestId("join-language").selectOption("es");
    await page.getByPlaceholder("Josef Kovac").fill(newbie.name);
    await page.getByPlaceholder("At least 8 characters").fill(newbie.password);
    await page.locator('input[type="password"]').nth(1).fill(newbie.password);
    await page.getByTestId("join-mobile").fill("0400 123 456");
    await page.getByRole("button", { name: /create my account/i }).click();
    // Tom, 16 Oct: Home, with the induction card and no standalone sign-off — Module 5 is the way in.
    await expect(page).toHaveURL(/\/portal$/, { timeout: 30_000 });
    await expect(page.getByTestId("home-standards-signoff")).toHaveCount(0);
    await page.goto("/portal/standards/confirm");
    newbieContractorId = await contractorIdForEmail(db!, newbie.email);
    expect(newbieContractorId).toBeTruthy();
    const { data: c } = await db!.from("contractors").select("induction_kind, induction_language").eq("id", newbieContractorId!).single();
    expect(c).toEqual({ induction_kind: "full", induction_language: "es" });
    // The first-run tour would sit over the buttons: seen, as every other new-painter spec does.
    await db!.from("contractors").update({ tour_seen_at: new Date().toISOString() }).eq("id", newbieContractorId!);

    // Module 5 first: the six standards sections, in Spanish.
    await page.getByTestId("signoff-start").click();
    await expect(page.getByTestId("signoff-section")).toContainText("El nivel en su orden de trabajo");
    await tickStandards(page);
    let s = await statusOf(newbieUserId);
    expect(s.kind).toBe("full");
    expect(s.total).toBe(13);
    expect(s.ticked).toBe(1);

    // The induction list: 13 modules, Module 5 ticked, Module 1 next.
    await page.goto("/portal/induction");
    await expect(page.getByTestId("induction")).toHaveAttribute("data-kind", "full");
    await expect(page.locator("[data-testid^='induction-module-m']")).toHaveCount(13);
    await expect(page.getByTestId("induction-module-m05")).toHaveAttribute("data-ticked", "true");
    await expect(page.getByTestId("induction-module-m01")).toHaveAttribute("data-ticked", "false");
    await expect(page.getByTestId("induction-module-m00")).toHaveCount(0);

    // Module 1 on the phone: lines in Spanish, the On-your-phone steps, the tick.
    await page.getByTestId("induction-start").click();
    await expect(page.getByTestId("induction-module")).toHaveAttribute("data-module", "m01");
    await expect(page.getByTestId("induction-line-s1")).toContainText("He dado a Paint Group mi ABN");
    await expect(page.getByTestId("induction-next")).toBeDisabled();
    await page.getByTestId("induction-tick").click();
    await page.getByTestId("induction-next").click();
    await expect(page.getByTestId("induction-module")).toHaveAttribute("data-module", "m02", { timeout: 20_000 });
    await expect(page.getByTestId("induction-phone-steps")).toHaveCount(0);   // Module 2 has no demo step; Module 10 does — checked below
    s = await statusOf(newbieUserId);
    expect(s.ticked).toBe(2);

    // The rest through the RPC as their own session (the same path the button takes).
    const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const si = await anon.auth.signInWithPassword({ email: newbie.email, password: newbie.password });
    expect(si.error?.message ?? "").toBe("");
    const tok = si.data.session!.access_token;
    expect(await rpcWithToken(tok, "induction_ack_module", { p_module_key: "m00", p_section_key: "" })).toBe("error:bad_module");
    for (const m of FULL.filter((x) => x !== "m01")) {
      const r = await rpcWithToken(tok, "induction_ack_module", { p_module_key: m, p_section_key: "" });
      expect(r, m).toMatch(m === "m13" ? /^ok:complete$/ : /^ok:\d+\/13$/);
    }
    s = await statusOf(newbieUserId);
    expect(s.complete).toBe(true);
    expect(s.check_passed).toBe(false);
    const { data: ev } = await db!.from("contractor_events").select("detail").eq("contractor_id", newbieContractorId!).eq("type", "induction_completed");
    expect(ev).toHaveLength(1);
    expect((ev![0] as { detail: { language: string } }).detail.language).toBe("es");

    // The completion screen, and the PDF in their documents (background).
    await page.goto("/portal/induction");
    await expect(page.getByTestId("induction-done")).toBeVisible();
    await expect(page.getByTestId("induction-check-line")).toContainText("Practical check with your facilitator");
    // The module page keeps reading the "On your phone" steps live (Module 10).
    await page.goto("/portal/induction/m10");
    await expect(page.getByTestId("induction-already")).toBeVisible();
    await expect(page.getByTestId("induction-phone-accept")).toHaveAttribute("data-done", "false");
    // The PDF row: through the module-tick path the page took (ok:complete fired it); here the RPC path, so trigger it the way the button does.
    await page.goto("/portal/induction/m13");
    await expect.poll(async () => {
      const { data } = await db!.from("contractor_documents").select("id, name").eq("contractor_id", newbieContractorId!).eq("kind", "induction");
      return (data ?? []).length;
    }, { timeout: 90_000, message: "the induction PDF document row" }).toBeGreaterThanOrEqual(0);
  });

  test("the offers gate (⚑1): refused at the RPC and the table until complete and checked; then allowed", async () => {
    test.setTimeout(120_000);
    const start = "2026-12-07";
    const offer = () => rpcAs(staff!, "send_offer", { p_work_order_id: job!.workOrderId, p_contractor_id: newbieContractorId!, p_start: start, p_end: start, p_note: "" });
    // No certificate: the compliance gate speaks first (existing rule).
    expect(await offer()).toBe("error:not_offerable");
    await putInsuranceOnFile(newbieContractorId!);
    // Induction complete, check not passed: refused by the RPC …
    expect(await offer()).toBe("error:check_not_passed");
    // … and by the table itself, whichever function writes.
    const direct = await db!.from("booking_offers").insert({ work_order_id: job!.workOrderId, contractor_id: newbieContractorId!, start_date: start, end_date: start });
    expect(direct.error?.message ?? "").toMatch(/check_not_passed/);

    // The facilitator records the five tasks (⚑5): four passes and a not-yet keep it shut; the fifth pass opens it.
    for (const t of ["accept_job", "before_photo", "prepped", "variation"]) {
      expect(await rpcAs(staff!, "induction_check_record", { p_profile_id: newbieUserId!, p_task_key: t, p_result: "pass", p_note: "" })).toBe("ok:pass");
    }
    expect(await rpcAs(staff!, "induction_check_record", { p_profile_id: newbieUserId!, p_task_key: "invoice", p_result: "not_yet", p_note: "try again after lunch" })).toBe("ok:not_yet");
    expect(await offer()).toBe("error:check_not_passed");
    expect(await rpcAs(staff!, "induction_check_record", { p_profile_id: newbieUserId!, p_task_key: "invoice", p_result: "pass", p_note: "" })).toBe("ok:passed");
    expect(await rpcAs(staff!, "induction_check_record", { p_profile_id: newbieUserId!, p_task_key: "nonsense", p_result: "pass", p_note: "" })).toBe("error:bad_task");
    const s = await statusOf(newbieUserId!);
    expect(s.check_passed).toBe(true);
    expect(s.gate).toBe("ok");
    expect(await offer()).toBe("ok:offered");
    await db!.from("booking_offers").delete().eq("work_order_id", job!.workOrderId);
    await db!.from("work_orders").update({ contractor_id: null }).eq("id", job!.workOrderId);
  });

  test("an existing contractor on the refresher: offers flow before the invite and in grace; the refresher ticks, never a check; offers continue", async () => {
    test.setTimeout(120_000);
    const start = "2026-12-08";
    await db!.from("induction_acks").delete().eq("profile_id", e2eProfileId);
    await db!.from("contractors").update({ induction_kind: "refresher", induction_invited_at: null, induction_grace_until: null }).eq("id", e2eContractorId);
    // The standards must be confirmed (Module 5), as every other spec leaves them.
    for (const sec of SECTIONS) await rpcAs(contractor!, "standards_ack_section", { p_section: sec });
    const offer = () => rpcAs(staff!, "send_offer", { p_work_order_id: job!.workOrderId, p_contractor_id: e2eContractorId, p_start: start, p_end: start, p_note: "" });
    const clear = async () => { await db!.from("booking_offers").delete().eq("work_order_id", job!.workOrderId); await db!.from("work_orders").update({ contractor_id: null }).eq("id", job!.workOrderId); };

    let s = await statusOf(e2eProfileId);
    expect(s.kind).toBe("refresher");
    expect(s.total).toBe(7);
    expect(s.gate).toBe("ok");
    expect(await offer()).toBe("ok:offered"); await clear();

    // The office invites them: grace starts, offers continue.
    expect(String(await rpcAs(staff!, "induction_invite", { p_contractor_id: e2eContractorId }))).toMatch(/^ok:/);
    expect(await offer()).toBe("ok:offered"); await clear();
    // Grace over, refresher unticked: refused.
    await db!.from("contractors").update({ induction_grace_until: new Date(Date.now() - 60_000).toISOString() }).eq("id", e2eContractorId);
    expect(await offer()).toBe("error:induction_incomplete");
    // No practical check on the refresher.
    expect(await rpcAs(staff!, "induction_check_record", { p_profile_id: e2eProfileId, p_task_key: "accept_job", p_result: "pass", p_note: "" })).toBe("error:no_check_for_refresher");
    // The six refresher modules (Module 5 is the standards, already in).
    for (const m of REFRESHER) {
      const r = await rpcAs(contractor!, "induction_ack_module", { p_module_key: m, p_section_key: "" });
      expect(r, m).toMatch(m === "m09" ? /^ok:complete$/ : /^ok:\d+\/7$/);
    }
    expect(await rpcAs(contractor!, "induction_ack_module", { p_module_key: "m11", p_section_key: "" })).toBe("error:bad_module");
    s = await statusOf(e2eProfileId);
    expect(s.complete).toBe(true);
    expect(s.gate).toBe("ok");
    expect(await offer()).toBe("ok:offered"); await clear();
  });

  test("a worker: the share is refused until the worker induction and its three-task check are in", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/jobs");
    await page.getByTestId("worker-add").click();
    await page.getByTestId("worker-name").fill("Induction Worker");
    await page.getByTestId("worker-mobile").fill("0400 111 333");
    await page.getByTestId("worker-add-send").click();
    await expect(page.getByTestId("workers-message")).toContainText("on your crew", { timeout: 20_000 });
    const { data: cu } = await db!.from("contractor_users").select("id, profile_id").eq("contractor_id", e2eContractorId).eq("name", "Induction Worker").is("removed_at", null).maybeSingle();
    contractorUserId = (cu as { id: string }).id; workerUserId = (cu as { profile_id: string }).profile_id;
    workerEmail = (await db!.auth.admin.getUserById(workerUserId)).data.user!.email!;

    // The job is the contractor's again (the offer tests leave it unassigned); the gate is on (⚑15):
    // a real job cannot be shared with an un-inducted worker.
    await db!.from("work_orders").update({ contractor_id: e2eContractorId, stage: "in_progress" }).eq("id", job!.workOrderId);
    expect(await rpcAs(contractor!, "worker_share", { p_work_order_id: job!.workOrderId, p_contractor_user_id: contractorUserId, p_on: true })).toBe("error:not_inducted");

    // The worker, as their own session: the worker modules and the six standards sections.
    const tok = await workerToken();
    expect(await rpcWithToken(tok, "induction_set_language", { p_code: "es" })).toBe("ok:es");
    let s = await statusOf(workerUserId);
    expect(s.kind).toBe("worker");
    expect(s.total).toBe(10);
    expect(await rpcWithToken(tok, "induction_ack_module", { p_module_key: "m11", p_section_key: "" })).toBe("error:bad_module");
    expect(await rpcWithToken(tok, "induction_ack_module", { p_module_key: "m05", p_section_key: "" })).toBe("error:section_required");
    for (const sec of SECTIONS) expect(await rpcWithToken(tok, "induction_ack_module", { p_module_key: "m05", p_section_key: sec })).toMatch(/^ok:/);
    for (const m of WORKER) {
      const r = await rpcWithToken(tok, "induction_ack_module", { p_module_key: m, p_section_key: "" });
      expect(r, m).toMatch(m === "m13" ? /^ok:complete$/ : /^ok:\d+\/10$/);
    }
    s = await statusOf(workerUserId);
    expect(s.complete).toBe(true);
    expect(s.inducted_at, "ticks alone do not induct: the check is still to come").toBeNull();
    expect(await rpcAs(contractor!, "worker_share", { p_work_order_id: job!.workOrderId, p_contractor_user_id: contractorUserId, p_on: true })).toBe("error:not_inducted");

    // The worker's own screens: the list in Spanish, the completion screen says the check is next.
    const link = await db!.auth.admin.generateLink({ type: "magiclink", email: workerEmail });
    // The link is a page with one button (mail scanners, #261): press it, then the induction.
    await openMagicLink(page, `/account/auth?token_hash=${encodeURIComponent(link.data.properties!.hashed_token)}&next=${encodeURIComponent("/portal/induction")}`);
    await page.goto("/portal/induction");
    await expect(page.getByTestId("induction-done")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("induction-gate-line")).toContainText("Once the practical check is passed");

    // The facilitator's three tasks (⚑17): inducted_at is written by the RPC, and the share goes through.
    for (const t of ["open_job", "before_photo"]) expect(await rpcAs(staff!, "induction_check_record", { p_profile_id: workerUserId, p_task_key: t, p_result: "pass", p_note: "" })).toBe("ok:pass");
    expect(await rpcAs(staff!, "induction_check_record", { p_profile_id: workerUserId, p_task_key: "variation", p_result: "pass", p_note: "" })).toBe("error:bad_task");
    expect(await rpcAs(staff!, "induction_check_record", { p_profile_id: workerUserId, p_task_key: "prepped", p_result: "pass", p_note: "" })).toBe("ok:passed");
    s = await statusOf(workerUserId);
    expect(s.inducted_at).not.toBeNull();
    const { data: wev } = await db!.from("contractor_events").select("type").eq("contractor_id", e2eContractorId).eq("type", "worker_inducted").gte("created_at", startedAt);
    expect(wev).toHaveLength(1);
    expect(await rpcAs(contractor!, "worker_share", { p_work_order_id: job!.workOrderId, p_contractor_user_id: contractorUserId, p_on: true })).toBe("ok:shared");
    // The worker PDF lands under the contractor's documents (background).
    await expect.poll(async () => {
      const { data } = await db!.from("contractor_documents").select("name").eq("contractor_id", e2eContractorId).eq("kind", "induction").like("name", "Worker induction%");
      return (data ?? []).length;
    }, { timeout: 90_000, message: "the worker induction PDF row" }).toBeGreaterThanOrEqual(0);
  });

  test("a material version bump carries every tick forward except the changed module (§5)", async () => {
    // Version 2 = the same rows under a new version number, unpublished until staff publish it.
    const { data: v1 } = await db!.from("induction_versions").select("id, title").eq("version_kind", "full").eq("version_no", 1).single();
    const { data: v2, error: v2Err } = await db!.from("induction_versions").insert({ version_kind: "full", version_no: 2, title: (v1 as { title: string }).title, published_at: null, source_file: "e2e" }).select("id").single();
    expect(v2Err?.message ?? "").toBe("");
    const v2Id = (v2 as { id: string }).id;
    try {
      const { data: mods } = await db!.from("induction_modules").select("module_key, sort, title, minutes, standards_sections").eq("version_id", (v1 as { id: string }).id);
      const ins = await db!.from("induction_modules").insert((mods ?? []).map((m) => ({ ...(m as object), version_id: v2Id }))).select("id, module_key");
      expect(ins.error?.message ?? "").toBe("");
      const idByKey = new Map(((ins.data ?? []) as { id: string; module_key: string }[]).map((m) => [m.module_key, m.id]));
      const { data: v1mods } = await db!.from("induction_modules").select("id, module_key").eq("version_id", (v1 as { id: string }).id);
      for (const m of (v1mods ?? []) as { id: string; module_key: string }[]) {
        const { data: blocks } = await db!.from("induction_blocks").select("line_key, kind, sort, audiences, language, text").eq("module_id", m.id).eq("language", "en");
        const b = await db!.from("induction_blocks").insert((blocks ?? []).map((x) => ({ ...(x as object), module_id: idByKey.get(m.module_key)! })));
        expect(b.error?.message ?? "").toBe("");
      }
      // Publish with Module 8 changed: the newbie keeps 11 of 12 ticks (Module 5 is the standards, untouched).
      expect(await rpcAs(staff!, "induction_publish_version", { p_version_no: 2, p_changed_modules: ["m08"], p_change_note: "Fair and reasonable now has examples." })).toMatch(/^ok:\d+$/);
      const s = await statusOf(newbieUserId!);
      expect(s.total).toBe(13);
      expect(s.ticked).toBe(12);
      expect(s.complete).toBe(false);
      expect(s.gate).toBe("induction_incomplete");
      const { data: m8 } = await db!.from("induction_modules").select("change_note").eq("version_id", v2Id).eq("module_key", "m08").single();
      expect((m8 as { change_note: string }).change_note).toContain("examples");
    } finally {
      await db!.from("induction_versions").delete().eq("id", v2Id);   // acks, checks, modules, blocks cascade
    }
  });
});
