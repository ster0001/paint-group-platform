import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn, TINY_SIGNATURE_PNG } from "./helpers";
import {
  accessTokenFor, completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  photosIn, rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor } from "./fixtures/portal";

/**
 * Tom, 9 Oct 2026 (migration 20270248):
 *   "the extra site visits don't send any alerts to the customer, they are
 *    logged just for Felipe."
 *   "site check ins shouldn't hold jobs back"
 *   "a site check in isn't documented as pass or fail, but progress notes can
 *    be made with the option to send to the painter, and also attach photos"
 *
 *   1. customer: a passed mid-job check is not "Quality check passed" on the
 *      residential timeline; the passed END-OF-JOB check is;
 *   2. painter: the job page lists the final quality check's day, never a
 *      mid-job or spot check (filtered in the server render);
 *   3. "+ Add a site check-in" on the PC makes a VISIT (wo_site_visits), not a
 *      quality check — and the job finishes to Walkthrough with it still open;
 *   4. PC Command shows it on its day; on the job page the office writes a
 *      note with a photo and sends it to the painter (outcome recorded on the
 *      note, in words), and an office-only note with a photo; Mark visited
 *      clears the card;
 *   5. row security: the painter's session reads only the sent note and its
 *      photo, never the visit or the office-only note; the customer and an
 *      anonymous caller read nothing;
 *   6. the painter's job page shows the sent note only; the customer's
 *      project page and the anonymous /w token page show none of it.
 *
 * Everything created here goes in afterAll: both fixture jobs (visits, notes,
 * photos and checks cascade from the estimate), the photo objects, the
 * messages the send recorded, the account chain and the customer login.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

const run = randomBytes(4).toString("hex");
const email = `pg.e2e.sitecheck.${run}@example.com`;
const SENT = `SENT-NOTE-${run} cut-in on the lounge ceiling needs a second look`;
const PRIVATE = `OFFICE-ONLY-${run} painter seemed short of drop sheets`;
const png = Buffer.from(TINY_SIGNATURE_PNG.split(",")[1], "base64");

let job: LoopFixture | null = null;     // the customer's job: leaks, notes, RLS
let hold: LoopFixture | null = null;    // a visit open while the job finishes
let shareToken = "";
let finalId = "";
let visitId = "";

const melbToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
const plus = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const restAs = async (token: string | null, path: string) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: anon, Authorization: `Bearer ${token ?? anon}` } });
  const body: unknown = await res.json();
  return { status: res.status, rows: Array.isArray(body) ? body as Record<string, unknown>[] : null };
};
const sessionFor = (token: string) => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
});

test.describe.configure({ mode: "serial" });

test.describe("site check-ins: Felipe's own visits — notes, photos, never a hold, never the customer's", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const sb = db!;
    const contractorId = (await contractorIdForEmail(sb, contractor!.email))!;
    job = await createLoopFixture(sb, contractorId, [{ heading: "Hallway", labels: ["Walls"] }]);
    hold = await createLoopFixture(sb, contractorId, [{ heading: "Front", labels: ["Walls"] }]);

    const acct = await sb.from("accounts").insert({ email, name: "Sam Sitecheck" }).select("id").single();
    if (acct.error) throw new Error(`account: ${acct.error.message}`);
    const link = await sb.from("estimates")
      .update({ account_id: acct.data.id, title: `${run} Sitecheck Street` })
      .eq("id", job.estimateId);
    if (link.error) throw new Error(`estimate link: ${link.error.message}`);

    const today = melbToday();
    const wo = await sb.from("work_orders")
      .update({ start_date: plus(today, -2), end_date: plus(today, 3) })
      .eq("id", job.workOrderId).select("share_token").single();
    if (wo.error) throw new Error(`work order dates: ${wo.error.message}`);
    shareToken = (wo.data as { share_token: string }).share_token;

    // A confirmed booking, so the painter's page treats the job as committed.
    const offer = await sb.from("booking_offers").insert({
      work_order_id: job.workOrderId, contractor_id: contractorId, state: "accepted",
      start_date: plus(today, -2), end_date: plus(today, 3), offered_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), accepted_at: new Date().toISOString(),
    });
    if (offer.error) throw new Error(`booking: ${offer.error.message}`);

    // The end-of-job check, dated, not yet recorded.
    const existing = await sb.from("wo_qa_checks").select("id")
      .eq("work_order_id", job.workOrderId).eq("kind", "final").limit(1);
    if (existing.error) throw new Error(`final check read: ${existing.error.message}`);
    const have = (existing.data ?? [])[0] as { id: string } | undefined;
    if (have) {
      const upd = await sb.from("wo_qa_checks").update({ scheduled_for: plus(today, 2) }).eq("id", have.id);
      if (upd.error) throw new Error(`final check date: ${upd.error.message}`);
      finalId = have.id;
    } else {
      const ins = await sb.from("wo_qa_checks")
        .insert({ work_order_id: job.workOrderId, kind: "final", scheduled_for: plus(today, 2) })
        .select("id").single();
      if (ins.error) throw new Error(`final check: ${ins.error.message}`);
      finalId = (ins.data as { id: string }).id;
    }

    // The office's extra CHECKS (pass/fail ones): a mid-job check already
    // PASSED, and a dated spot check still to come.
    const extras = await sb.from("wo_qa_checks").insert([
      {
        work_order_id: job.workOrderId, kind: "mid", trigger: "mid", result: "pass",
        scheduled_for: plus(today, -1), checked_at: new Date(Date.now() - 86_400_000).toISOString(),
      },
      { work_order_id: job.workOrderId, kind: "spot", trigger: "spot", scheduled_for: plus(today, 1) },
    ]);
    if (extras.error) throw new Error(`extra checks: ${extras.error.message}`);
  });

  test.afterAll(async () => {
    const sb = db!;
    for (const fx of [job, hold]) {
      if (!fx) continue;
      const { data: objects, error: listErr } = await sb.from("wo_site_visit_photos").select("storage_path").eq("work_order_id", fx.workOrderId);
      if (listErr) console.warn(`site-checkins teardown photos: ${listErr.message}`);
      const paths = ((objects ?? []) as { storage_path: string }[]).map((o) => o.storage_path);
      if (paths.length) {
        const { error } = await sb.storage.from("site-visit-photos").remove(paths);
        if (error) console.warn(`site-checkins teardown objects: ${error.message}`);
      }
      const { error: msgErr } = await sb.from("messages").delete().eq("work_order_id", fx.workOrderId);
      if (msgErr) console.warn(`site-checkins teardown messages: ${msgErr.message}`);
    }
    await destroyLoopFixture(sb, job);
    await destroyLoopFixture(sb, hold);
    await destroyAccountChain(sb, email);
    await deleteUserByEmail(sb, email);
  });

  test("customer: a passed mid-job check is not a milestone; the passed final check is", async ({ page }) => {
    const sb = db!;
    await page.goto(await magicLinkFor(sb, email));
    await page.goto("/account/project");
    await expect(page.getByText(`${run} Sitecheck Street`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Quality check passed")).toHaveCount(0);
    await expect(page.getByText(/site check-in|spot check|mid-job check/i)).toHaveCount(0);

    const passed = await sb.from("wo_qa_checks")
      .update({ result: "pass", checked_at: new Date().toISOString() }).eq("id", finalId);
    if (passed.error) throw new Error(`final pass: ${passed.error.message}`);
    await page.reload();
    await expect(page.getByText("Quality check passed").first()).toBeVisible({ timeout: 20_000 });
  });

  test("painter: the job page shows the final quality check, never a mid-job or spot check", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    await expect(page.getByTestId("finish-date")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("qa-dates")).toContainText(/Paint Group quality check/i);
    await expect(page.getByText(/mid-job check|spot check|site check-in/i)).toHaveCount(0);
    // Not merely hidden: the server never put them in the page.
    const html = (await page.content()).toLowerCase();
    expect(html).not.toContain("mid-job check");
    expect(html).not.toContain("spot check");
  });

  test("the PC's \"+ Add a site check-in\" makes a visit, not a check — and the job finishes to Walkthrough with it open", async ({ page }) => {
    const id = hold!.workOrderId;
    // No quality check on this job, so nothing but the visit could hold it.
    expect(await rpcAs(staff!, "wo_set_qa_waived", { p_work_order_id: id, p_waived: true })).toMatch(/^ok:waived/);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${id}`);
    await page.getByTestId("qa-mid-open").click();
    await page.getByTestId("qa-mid-date").fill(melbToday());
    await page.getByTestId("qa-mid-time").fill("23:45");
    await page.getByTestId("qa-mid-add").click();
    await expect(page.getByTestId("qa-controls-msg")).toContainText(/Site check-in added/i, { timeout: 30_000 });
    await expect(page.getByTestId("site-visits-card")).toBeVisible({ timeout: 30_000 });

    const visits = await db!.from("wo_site_visits").select("id, scheduled_time, visited_at").eq("work_order_id", id);
    if (visits.error) throw visits.error;
    expect(visits.data).toHaveLength(1);
    expect((visits.data![0] as { scheduled_time: string }).scheduled_time).toBe("23:45:00");
    const checks = await db!.from("wo_qa_checks").select("id").eq("work_order_id", id);
    if (checks.error) throw checks.error;
    expect(checks.data ?? []).toHaveLength(0);
    // A visit is not a check: the office's "not required" stands.
    const wo = await db!.from("work_orders").select("qa_waived").eq("id", id).single();
    expect((wo.data as { qa_waived: boolean }).qa_waived).toBe(true);
    const open = await db!.rpc("wo_qa_open_count", { p_work_order_id: id });
    if (open.error) throw open.error;
    expect(open.data).toBe(0);

    // The painter finishes; the open visit holds nothing.
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", id);
    await photosIn(db!, id);
    await completePrep(db!, staff!, id);
    const finished = await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: id });
    expect(finished).toMatch(/^ok:completion_prep/);
    expect(finished).not.toContain("qa_pending");
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: id })).toMatch(/^ok:walkthrough/);
    const moved = await db!.from("work_orders").select("stage").eq("id", id).single();
    expect((moved.data as { stage: string }).stage).toBe("walkthrough");
    const still = await db!.from("wo_site_visits").select("visited_at").eq("work_order_id", id).single();
    expect((still.data as { visited_at: string | null }).visited_at).toBeNull();
  });

  test("PC Command lists it on its day; a note with a photo goes to the painter, outcome recorded; an office-only note stays; Mark visited clears it", async ({ page }) => {
    const id = job!.workOrderId;
    const added = await rpcAs(staff!, "wo_add_site_visit", { p_work_order_id: id, p_date: melbToday(), p_time: "23:45" });
    expect(added).toMatch(/^ok:/);
    visitId = added.slice(3);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.getByTestId(`site-visit-card-site_visit_due:work_order:${id}:${visitId}`);
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(/Site check-in today at 23:45/);
    await card.getByRole("link", { name: "Open the check-in" }).click();
    const visit = page.getByTestId(`site-visit-${visitId}`);
    await expect(visit).toBeVisible({ timeout: 60_000 });

    // A note for the painter, with a photo, sent.
    await visit.getByTestId("site-visit-note-input").fill(SENT);
    await visit.getByTestId("site-visit-note-photos").setInputFiles({ name: "ceiling.png", mimeType: "image/png", buffer: png });
    await visit.getByTestId("site-visit-note-send-tick").check();
    await visit.getByTestId("site-visit-note-add").click();
    await expect(visit.getByTestId("site-visit-msg")).toContainText(/Note saved with 1 of 1 photo/, { timeout: 60_000 });
    const sentNote = visit.locator('[data-testid^="site-visit-note-"]', { hasText: SENT }).first();
    await expect(sentNote.getByTestId("site-visit-note-share")).toHaveText(/^(Sent to .+|On the painter's job page, but no text or email went: .+)/, { timeout: 30_000 });

    // An office-only note, with a photo, not sent.
    await visit.getByTestId("site-visit-note-input").fill(PRIVATE);
    await visit.getByTestId("site-visit-note-photos").setInputFiles({ name: "sheets.png", mimeType: "image/png", buffer: png });
    await visit.getByTestId("site-visit-note-add").click();
    await expect(visit.getByTestId("site-visit-msg")).toContainText(/Note saved with 1 of 1 photo/, { timeout: 60_000 });
    const privateNote = visit.locator('[data-testid^="site-visit-note-"]', { hasText: PRIVATE }).first();
    await expect(privateNote.getByTestId("site-visit-note-share")).toHaveText("Office only — the painter has not been sent this.");

    const notes = await db!.from("wo_site_visit_notes").select("id, body, send_to_painter, sent_outcome, sent_detail")
      .eq("visit_id", visitId).order("created_at");
    if (notes.error) throw notes.error;
    const rows = notes.data as { id: string; body: string; send_to_painter: boolean; sent_outcome: string | null; sent_detail: string }[];
    expect(rows.map((r) => [r.body, r.send_to_painter])).toEqual([[SENT, true], [PRIVATE, false]]);
    expect(rows[0].sent_outcome).toMatch(/^(sent|skipped)$/);
    expect(rows[0].sent_detail.length).toBeGreaterThan(0);
    expect(rows[1].sent_outcome).toBeNull();
    const photos = await db!.from("wo_site_visit_photos").select("id").eq("visit_id", visitId);
    expect(photos.data ?? []).toHaveLength(2);
    await expect(visit.getByTestId("site-visit-note-photo")).toHaveCount(2);

    // Mark visited — never a pass or a fail — clears the card.
    await visit.getByTestId("site-visit-mark").click();
    await expect(visit.getByTestId("site-visit-visited")).toBeVisible({ timeout: 30_000 });
    await page.goto("/pc");
    await expect(page.getByTestId("queue")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId(`site-visit-card-site_visit_due:work_order:${id}:${visitId}`)).toHaveCount(0);
  });

  test("row security: the painter reads only the sent note and its photo; the customer and anonymous read nothing", async () => {
    const id = job!.workOrderId;
    const sb = db!;
    const { data: photoRows, error: photoErr } = await sb.from("wo_site_visit_photos")
      .select("storage_path, wo_site_visit_notes(body)").eq("visit_id", visitId);
    if (photoErr) throw photoErr;
    const byBody = new Map(((photoRows ?? []) as unknown as { storage_path: string; wo_site_visit_notes: { body: string } | null }[])
      .map((p) => [p.wo_site_visit_notes?.body ?? "", p.storage_path]));
    const sentPath = byBody.get(SENT) ?? "";
    const privatePath = byBody.get(PRIVATE) ?? "";
    expect(sentPath).not.toBe("");
    expect(privatePath).not.toBe("");

    // The painter, through their own session.
    const painterToken = await accessTokenFor(contractor!);
    const pNotes = await restAs(painterToken, `wo_site_visit_notes?select=body&work_order_id=eq.${id}`);
    expect(pNotes.status).toBe(200);
    expect(pNotes.rows!.map((r) => r.body)).toEqual([SENT]);
    const pVisits = await restAs(painterToken, `wo_site_visits?select=id&work_order_id=eq.${id}`);
    expect(pVisits.rows).toEqual([]);
    const pPhotos = await restAs(painterToken, `wo_site_visit_photos?select=storage_path&work_order_id=eq.${id}`);
    expect(pPhotos.rows!.map((r) => r.storage_path)).toEqual([sentPath]);
    const painterStore = sessionFor(painterToken).storage.from("site-visit-photos");
    expect((await painterStore.createSignedUrl(sentPath, 60)).data?.signedUrl).toBeTruthy();
    expect((await painterStore.createSignedUrl(privatePath, 60)).data?.signedUrl ?? null).toBeNull();
    // Writes are the office's: a painter cannot add a note.
    expect(await rpcAs(contractor!, "wo_site_visit_add_note", { p_visit_id: visitId, p_body: "x", p_send: false })).toBe("error:not_staff");

    // The customer, through their own session.
    const link = await sb.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;
    const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const verified = await pub.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
    if (verified.error || !verified.data.session) throw new Error(`customer session: ${verified.error?.message ?? "none"}`);
    const customerToken = verified.data.session.access_token;
    for (const table of ["wo_site_visits", "wo_site_visit_notes", "wo_site_visit_photos"]) {
      const r = await restAs(customerToken, `${table}?select=id&work_order_id=eq.${id}`);
      expect(r.rows, `customer reads ${table}`).toEqual([]);
    }
    expect((await sessionFor(customerToken).storage.from("site-visit-photos").createSignedUrl(sentPath, 60)).data?.signedUrl ?? null).toBeNull();

    // Anonymous: no grant at all.
    const anonClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    for (const table of ["wo_site_visits", "wo_site_visit_notes", "wo_site_visit_photos"]) {
      const r = await restAs(null, `${table}?select=id&work_order_id=eq.${id}`);
      expect(r.rows ?? [], `anon reads ${table}`).toEqual([]);
    }
    const anonAdd = await anonClient.rpc("wo_add_site_visit", { p_work_order_id: id, p_date: melbToday(), p_time: "23:00" });
    expect(anonAdd.error?.code).toBe("42501");
  });

  test("the painter's job page shows the sent note; the customer and the /w page show none of it", async ({ page, browser }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    const notes = page.getByTestId("office-notes");
    await expect(notes).toBeVisible({ timeout: 20_000 });
    await expect(notes).toContainText(SENT);
    await expect(notes.getByTestId("office-note-photo")).toHaveCount(1);
    expect(await page.content()).not.toContain(PRIVATE);
    await expect(page.getByText(/site check-in/i)).toHaveCount(0);

    const customer = await browser.newContext();
    const cp = await customer.newPage();
    await cp.goto(await magicLinkFor(db!, email));
    await cp.goto("/account/project");
    await expect(cp.getByText(`${run} Sitecheck Street`)).toBeVisible({ timeout: 20_000 });
    const customerHtml = await cp.content();
    expect(customerHtml).not.toContain(SENT);
    expect(customerHtml).not.toContain(PRIVATE);
    expect(customerHtml.toLowerCase()).not.toContain("site check-in");
    await customer.close();

    const anon = await browser.newContext();
    const ap = await anon.newPage();
    const res = await ap.goto(`/w/${shareToken}`);
    expect(res?.status() ?? 0).toBeLessThan(500);
    const anonHtml = await ap.content();
    expect(anonHtml).not.toContain(SENT);
    expect(anonHtml).not.toContain(PRIVATE);
    expect(anonHtml.toLowerCase()).not.toMatch(/site check-in|spot check|mid-job check/);
    await anon.close();
  });
});
