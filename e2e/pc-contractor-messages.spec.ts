import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  accessTokenFor, contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Messages between the office and the painter, per project (Tom, 9 Oct 2026):
 * "a message box in PC Command in the project, to message the contractor —
 * this shows up in a messages box and the contractor can see which project
 * the message is linked to — photos can be attached from both sides to send
 * each way."
 *
 * The journey, in order, through the real screens:
 *   1. the office writes on the job page with a photo, and is told in words
 *      what telling the painter came to;
 *   2. the painter sees it in Messages on Home, named by job ref + suburb (no
 *      street), opens the job at its thread, sees the photo, replies with one;
 *   3. a "<painter> replied on <job>" card is on PC Command, and goes once the
 *      office has opened the thread;
 *   4. reads through EACH ROLE'S OWN SESSION — never the service key: the
 *      painter sees their thread, another painter and a customer see nothing
 *      and cannot post, anon is refused, and the photo cannot be signed by
 *      anyone but the two sides.
 *
 * The service key only builds and removes the fixture. Everything made here —
 * the job (threads and messages cascade with it), the photos in the bucket and
 * the second painter's login — is removed in afterAll.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const run = Date.now().toString(36);
let fixture: LoopFixture | null = null;
let contractorId = "";
let woRef = "";
const other = { email: `pg.e2e.painter.${run}@example.com`, password: `Painter-${run}-pw!`, userId: "", contractorId: "" };

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const OFFICE_SAYS = `Scaffold arrives Monday ${run} — keep the side path clear.`;
const PAINTER_SAYS = `Found rot under the back sill ${run} — photo attached.`;

type Who = { email: string; password: string };
async function headersFor(who: Who | null): Promise<Record<string, string>> {
  return who ? { apikey: ANON, Authorization: `Bearer ${await accessTokenFor(who)}` } : { apikey: ANON };
}
/** A REST read as a role — the rows RLS lets through, or the refusal. */
async function readAs(who: Who | null, path: string): Promise<{ status: number; rows: unknown[] | null }> {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: await headersFor(who) });
  const body = await res.json().catch(() => null);
  return { status: res.status, rows: Array.isArray(body) ? body : null };
}
async function rpcAs(who: Who | null, fn: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { ...(await headersFor(who)), "Content-Type": "application/json" }, body: JSON.stringify(args),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function signPhotoAs(who: Who | null, path: string): Promise<number> {
  const res = await fetch(`${URL}/storage/v1/object/sign/wo-messages/${path}`, {
    method: "POST", headers: { ...(await headersFor(who)), "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }),
  });
  return res.ok ? 200 : res.status;
}

async function threadRow() {
  const r = await readAs(staff, `wo_message_threads?work_order_id=eq.${fixture!.workOrderId}&select=id,contractor_id,staff_unread,painter_unread`);
  return (r.rows ?? []) as { id: string; contractor_id: string; staff_unread: boolean; painter_unread: boolean }[];
}

test.describe("PC Command ↔ painter messages, per project", () => {
  test.skip(!staff || !contractor || !customer, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email)) ?? "";
    if (!contractorId) throw new Error("the E2E contractor has no contractors row");
    fixture = await createLoopFixture(db!, contractorId, [{ heading: "Back", labels: ["Walls", "Sills"] }]);
    woRef = `WO-MSG${run.slice(-5).toUpperCase()}`;
    const ref = await db!.from("work_orders").update({ wo_ref: woRef }).eq("id", fixture.workOrderId);
    if (ref.error) throw new Error(`fixture ref: ${ref.error.message}`);

    // A second painter, on no job of ours — the one who must see nothing.
    const created = await db!.auth.admin.createUser({ email: other.email, password: other.password, email_confirm: true, user_metadata: { name: "E2E Other Painter" } });
    if (created.error || !created.data.user) throw new Error(`other painter: ${created.error?.message}`);
    other.userId = created.data.user.id;
    const role = await db!.from("profiles").update({ role: "contractor", name: "E2E Other Painter" }).eq("id", other.userId);
    if (role.error) throw new Error(`other painter role: ${role.error.message}`);
    const c = await db!.from("contractors").insert({ profile_id: other.userId, tier: "B", active: true, company_name: "Other Co" }).select("id").single();
    if (c.error) throw new Error(`other painter row: ${c.error.message}`);
    other.contractorId = (c.data as { id: string }).id;
  });

  test.afterAll(async () => {
    if (fixture) {
      // The photos first — storage does not cascade with the job.
      const folder = `${fixture.workOrderId}/${contractorId}`;
      const listed = await db!.storage.from("wo-messages").list(folder, { limit: 100 });
      if (listed.error) throw new Error(`teardown list: ${listed.error.message}`);
      const paths = (listed.data ?? []).map((o) => `${folder}/${o.name}`);
      if (paths.length) {
        const rm = await db!.storage.from("wo-messages").remove(paths);
        if (rm.error) throw new Error(`teardown photos: ${rm.error.message}`);
      }
      await destroyLoopFixture(db!, fixture);
    }
    if (other.contractorId) {
      const r = await db!.from("contractors").delete().eq("id", other.contractorId);
      if (r.error) throw new Error(`teardown contractors: ${r.error.message}`);
    }
    if (other.userId) {
      const u = await db!.auth.admin.deleteUser(other.userId);
      if (u.error) throw new Error(`teardown user: ${u.error.message}`);
    }
  });

  test("the office writes on the job page with a photo, and is told what telling the painter came to", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);
    const box = page.getByTestId("msg-box");
    await expect(box).toBeVisible({ timeout: 30_000 });
    await expect(box).toHaveAttribute("data-mode", "staff");
    await expect(box.getByTestId("msg-empty")).toBeVisible();

    await box.getByTestId("msg-input").fill(OFFICE_SAYS);
    await box.getByTestId("msg-photo-input").setInputFiles({ name: "path.png", mimeType: "image/png", buffer: PNG });
    await expect(box.getByTestId("msg-staged")).toContainText("Ready", { timeout: 30_000 });
    await box.getByTestId("msg-send").click();

    // In words: texted / emailed / held / not sent and why — never silence.
    await expect(box.getByTestId("msg-status")).toContainText(/^Sent\. (Texted|Emailed|Outside sending hours|Waiting for approval|Not sent|Nothing went out|Not texted)/, { timeout: 30_000 });
    const mine = box.getByTestId("msg-item").filter({ hasText: OFFICE_SAYS });
    await expect(mine).toHaveCount(1);
    await expect(mine).toHaveAttribute("data-side", "staff");
    await expect(mine.getByTestId("msg-photo")).toHaveCount(1);
    await expect(mine.getByTestId("msg-notify")).toHaveText(/\w/);

    // The job's log records the OUTCOME (sent, or skipped with a reason) — read as staff.
    const ev = await readAs(staff, `wo_events?work_order_id=eq.${fixture!.workOrderId}&type=in.(message_notified,message_notified_skipped)&select=type,meta`);
    expect(ev.rows?.length, "one outcome on the job's log").toBe(1);
  });

  test("the painter sees it in Messages, named by job ref and suburb, and replies with a photo", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal");
    const home = page.getByTestId("home-messages");
    await expect(home).toBeVisible({ timeout: 30_000 });
    const line = home.getByTestId(`home-message-${fixture!.workOrderId}`);
    await expect(line.getByTestId("home-message-job")).toHaveText(`${woRef} · Melbourne`);
    await expect(line.getByTestId("home-message-unread")).toHaveText("1 new");
    // The project, never the customer: no street in the painter's Home HTML.
    expect(await page.content()).not.toContain("1 Test St");

    await line.click();
    await expect(page).toHaveURL(new RegExp(`/portal/jobs/${fixture!.workOrderId}#messages`));
    const box = page.getByTestId("msg-box");
    await expect(box).toHaveAttribute("data-mode", "painter");
    const fromOffice = box.getByTestId("msg-item").filter({ hasText: OFFICE_SAYS });
    await expect(fromOffice).toHaveAttribute("data-side", "staff");
    await expect(fromOffice.getByTestId("msg-photo")).toHaveCount(1);
    // The office's delivery notes are not the painter's business — not in their page at all.
    await expect(box.getByTestId("msg-notify")).toHaveCount(0);

    await box.getByTestId("msg-input").fill(PAINTER_SAYS);
    await box.getByTestId("msg-photo-input").setInputFiles({ name: "rot.png", mimeType: "image/png", buffer: PNG });
    await expect(box.getByTestId("msg-staged")).toContainText("Ready", { timeout: 30_000 });
    await box.getByTestId("msg-send").click();
    await expect(box.getByTestId("msg-status")).toHaveText("Sent to the office.", { timeout: 30_000 });
    const reply = box.getByTestId("msg-item").filter({ hasText: PAINTER_SAYS });
    await expect(reply).toHaveAttribute("data-side", "painter");
    await expect(reply.getByTestId("msg-photo")).toHaveCount(1);

    // Opening the thread read it: Home has nothing new now.
    await page.goto("/portal");
    await expect(page.getByTestId(`home-message-${fixture!.workOrderId}`).getByTestId("home-message-unread")).toHaveCount(0);
  });

  test("PC Command shows '<painter> replied on <job>', and it clears once the office opens the thread", async ({ page }) => {
    const [t] = await threadRow();
    expect(t?.staff_unread).toBe(true);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.getByTestId(`message-card-${t.id}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(`replied on ${woRef}`);
    await expect(card).toContainText(PAINTER_SAYS.slice(0, 30));

    await page.getByTestId(`message-card-open-${t.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/pc/wo/${fixture!.workOrderId}\\?painter=${contractorId}`));
    await expect(page.getByTestId("msg-box").getByTestId("msg-item").filter({ hasText: PAINTER_SAYS })).toHaveCount(1);
    await expect.poll(async () => (await threadRow())[0]?.staff_unread, { timeout: 15_000 }).toBe(false);

    await page.goto("/pc");
    await expect(page.getByTestId("queue")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`message-card-${t.id}`)).toHaveCount(0);
  });

  test("each role reads through its own session: the painter theirs, nobody else anything", async () => {
    const [t] = await threadRow();
    const msgs = await readAs(staff, `wo_messages?thread_id=eq.${t.id}&select=id,author_kind,photo_paths&order=created_at`);
    expect(msgs.rows?.length).toBe(2);
    const photo = ((msgs.rows ?? []) as { photo_paths: string[] }[])[0].photo_paths[0];
    expect(photo.startsWith(`${fixture!.workOrderId}/${contractorId}/`)).toBe(true);

    // The painter on the job: their thread, both messages, the photo signs.
    expect((await readAs(contractor, `wo_message_threads?work_order_id=eq.${fixture!.workOrderId}&select=id`)).rows).toHaveLength(1);
    expect((await readAs(contractor, `wo_messages?thread_id=eq.${t.id}&select=id`)).rows).toHaveLength(2);
    expect(await signPhotoAs(contractor, photo)).toBe(200);
    const mine = await rpcAs(contractor, "wo_my_message_threads", {});
    expect((mine.body as { work_order_id: string }[]).some((r) => r.work_order_id === fixture!.workOrderId)).toBe(true);

    // Another painter: nothing to read, nothing to sign, cannot post into it or as themselves.
    const otherWho = { email: other.email, password: other.password };
    expect((await readAs(otherWho, `wo_message_threads?work_order_id=eq.${fixture!.workOrderId}&select=id`)).rows).toEqual([]);
    expect((await readAs(otherWho, `wo_messages?thread_id=eq.${t.id}&select=id`)).rows).toEqual([]);
    expect(await signPhotoAs(otherWho, photo)).not.toBe(200);
    expect((await rpcAs(otherWho, "wo_my_message_threads", {})).body).toEqual([]);
    expect((await rpcAs(otherWho, "wo_message_post", { p_work_order_id: fixture!.workOrderId, p_contractor_id: contractorId, p_body: "let me in", p_photo_paths: [] })).body)
      .toEqual({ error: "not_yours" });
    expect((await rpcAs(otherWho, "wo_message_post", { p_work_order_id: fixture!.workOrderId, p_contractor_id: other.contractorId, p_body: "or this way", p_photo_paths: [] })).body)
      .toEqual({ error: "not_yours" });
    expect((await rpcAs(otherWho, "wo_message_mark_read", { p_thread_id: t.id })).body).toBe("error:not_yours");

    // The customer: nothing.
    expect((await readAs(customer, `wo_message_threads?work_order_id=eq.${fixture!.workOrderId}&select=id`)).rows).toEqual([]);
    expect((await readAs(customer, `wo_messages?thread_id=eq.${t.id}&select=id`)).rows).toEqual([]);
    expect(await signPhotoAs(customer, photo)).not.toBe(200);
    expect((await rpcAs(customer, "wo_message_post", { p_work_order_id: fixture!.workOrderId, p_contractor_id: contractorId, p_body: "hi", p_photo_paths: [] })).body)
      .toEqual({ error: "not_yours" });

    // No session at all: refused outright (no grant), and nothing signs.
    const anonRead = await readAs(null, `wo_messages?thread_id=eq.${t.id}&select=id`);
    expect(anonRead.rows === null || anonRead.rows.length === 0).toBe(true);
    expect((await rpcAs(null, "wo_message_post", { p_work_order_id: fixture!.workOrderId, p_contractor_id: contractorId, p_body: "x", p_photo_paths: [] })).status).not.toBe(200);
    expect(await signPhotoAs(null, photo)).not.toBe(200);

    // And nobody can write the tables directly — the functions are the only door.
    const direct = await fetch(`${URL}/rest/v1/wo_messages`, {
      method: "POST", headers: { ...(await headersFor(contractor)), "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: t.id, author_kind: "staff", body: "pretending to be the office" }),
    });
    expect(direct.ok).toBe(false);
  });
});
