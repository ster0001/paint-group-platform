import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { openMagicLink } from "./fixtures/portal";

/**
 * Worker logins — induction brief §8 Step 3a (rulings 3, 13, 14).
 *
 * AS THE CONTRACTOR: add a worker (name + mobile) under Your crew → a login
 * exists for them; share one job with them from the job page (the other job
 * stays unshared); later remove them.
 * AS THE WORKER (a login redeemed from the texted magic link): Home lists the
 * shared job only; the unshared job is 404; no Requests, Invoicing or
 * Calendar tab; the job page is the worker shape with no "$" on it; a tick
 * through the real tick list lands as a wo_events row with actor = the
 * worker's login and actor_kind = worker. Straight at the database with the
 * worker's own session: work_orders, booking_offers, contractor_invoices,
 * wo_variations and wo_events answer [] (no money table opens), wo_surfaces
 * answers rows for the shared job and [] for the other. After removal:
 * worker_jobs() is empty and the shared job's surfaces read [] — locked out
 * at once.
 *
 * Rows: two loop fixtures on the e2e contractor, one worker auth user; all
 * removed in afterAll (the worker's contractor_users row cascades from the
 * auth user).
 */
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let contractorId = "";
let shared: LoopFixture | null = null;
let other: LoopFixture | null = null;
let workerUserId = "";
let workerEmail = "";
let contractorUserId = "";
let workerToken = "";

/** A session for the worker, the way their phone gets one: the magic link, redeemed. */
async function workerSession(): Promise<string> {
  const link = await db!.auth.admin.generateLink({ type: "magiclink", email: workerEmail });
  expect(link.error?.message ?? "").toBe("");
  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const v = await anon.auth.verifyOtp({ type: "email", token_hash: link.data.properties!.hashed_token });
  expect(v.error?.message ?? "").toBe("");
  return v.data.session!.access_token;
}

async function readAs(token: string, table: string, query: string): Promise<unknown[]> {
  const r = await fetch(`${URL}/rest/v1/${table}?${query}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

async function loginWorker(page: Page) {
  const link = await db!.auth.admin.generateLink({ type: "magiclink", email: workerEmail });
  expect(link.error?.message ?? "").toBe("");
  // The link is a page with one button since #261 (mail scanners): press it.
  await openMagicLink(page, `/account/auth?token_hash=${encodeURIComponent(link.data.properties!.hashed_token)}&next=${encodeURIComponent("/portal")}`);
  await expect(page).toHaveURL(/\/portal/, { timeout: 20_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("worker logins — a small login under a contractor", () => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    expect(contractorId).toBeTruthy();
    shared = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls", "Ceilings"] }]);
    other = await createLoopFixture(db!, contractorId, [{ heading: "Bedroom", labels: ["Walls"] }]);
    // A before photo on the shared job, so the tick list is open to tick.
    await db!.from("wo_photos").insert({ work_order_id: shared.workOrderId, kind: "before", area: "Lounge", storage_path: `wo/${shared.workOrderId}/e2e-before.jpg` });
  });

  test.afterAll(async () => {
    if (workerUserId) await db!.auth.admin.deleteUser(workerUserId);   // contractor_users and the shares cascade
    await destroyLoopFixture(db!, shared);
    await destroyLoopFixture(db!, other);
  });

  test("as the contractor: add a worker under Your crew — a login exists for them", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/jobs");
    await page.getByTestId("worker-add").click();
    await page.getByTestId("worker-name").fill("E2E Worker");
    await page.getByTestId("worker-mobile").fill("0400 111 222");
    await page.getByTestId("worker-add-send").click();
    await expect(page.getByTestId("workers-message")).toContainText("on your crew", { timeout: 20_000 });
    const { data } = await db!.from("contractor_users").select("id, profile_id, role, name, mobile, removed_at").eq("contractor_id", contractorId).eq("name", "E2E Worker").maybeSingle();
    const row = data as { id: string; profile_id: string; role: string; name: string; mobile: string; removed_at: string | null } | null;
    expect(row).toBeTruthy();
    contractorUserId = row!.id; workerUserId = row!.profile_id;
    expect(row!.role).toBe("worker");
    expect(row!.mobile).toBe("+61400111222");
    const u = await db!.auth.admin.getUserById(workerUserId);
    workerEmail = u.data.user?.email ?? "";
    expect(workerEmail).toMatch(/^worker-[0-9a-f-]+@workers\./);
    const { data: p } = await db!.from("profiles").select("role").eq("id", workerUserId).single();
    expect((p as { role: string }).role).toBe("contractor");
    await expect(page.getByTestId(`worker-${contractorUserId}`)).toContainText("E2E Worker");
  });

  test("as the contractor: share one job from its page", async ({ page }) => {
    // The share gate (⚑15, on since induction Step 5) wants an inducted worker; the
    // induction itself is e2e/induction.spec.ts. Here the fixture is inducted by hand.
    await db!.from("contractor_users").update({ inducted_at: new Date().toISOString() }).eq("id", contractorUserId);
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${shared!.workOrderId}`);
    await page.getByTestId(`worker-share-${contractorUserId}`).click();
    await expect(page.getByTestId(`worker-share-${contractorUserId}`)).toContainText("Shared", { timeout: 20_000 });
    const { data } = await db!.from("wo_worker_shares").select("unshared_at").eq("work_order_id", shared!.workOrderId).eq("contractor_user_id", contractorUserId).single();
    expect((data as { unshared_at: string | null }).unshared_at).toBeNull();
  });

  test("as the worker: only the shared job, no money tab, the worker shape of the page, a tick under their own name", async ({ page }) => {
    await loginWorker(page);
    await expect(page.getByTestId("worker-home")).toBeVisible();
    await expect(page.getByTestId(`worker-job-${shared!.workOrderId}`)).toBeVisible();
    await expect(page.getByTestId(`worker-job-${other!.workOrderId}`)).toHaveCount(0);
    for (const label of ["REQUESTS", "INVOICING", "EXPENSES", "CALENDAR"]) await expect(page.locator("nav").getByText(label)).toHaveCount(0);

    await page.goto(`/portal/jobs/${other!.workOrderId}`);
    await expect(page.locator("body")).toContainText(/not found|404/i);

    await page.goto(`/portal/jobs/${shared!.workOrderId}`);
    await expect(page.getByTestId("worker-job")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("$");
    await expect(page.getByTestId("tick-list")).toBeVisible();
    const walls = shared!.surfaces.find((s) => s.label === "Walls")!;
    await page.getByTestId(`tick-${walls.id}`).click();
    const ev = await (async () => {
      for (let i = 0; i < 40; i++) {
        const { data } = await db!.from("wo_events").select("actor, actor_kind").eq("work_order_id", shared!.workOrderId).eq("type", "surface_tick").order("created_at", { ascending: false }).limit(1);
        if (data && data.length) return data[0] as { actor: string; actor_kind: string };
        await new Promise((r) => setTimeout(r, 500));
      }
      return null;
    })();
    expect(ev, "the tick is a wo_events row").toBeTruthy();
    expect(ev!.actor).toBe(workerUserId);
    expect(ev!.actor_kind).toBe("worker");
    const { data: s } = await db!.from("wo_surfaces").select("state").eq("id", walls.id).single();
    expect((s as { state: string }).state).not.toBe("todo");
  });

  test("straight at the database as the worker: no money table answers; only the shared job's rows", async () => {
    workerToken = await workerSession();
    for (const [table, q] of [
      ["work_orders", `select=id&id=eq.${shared!.workOrderId}`],
      ["booking_offers", "select=id&limit=5"],
      ["contractor_invoices", "select=id&limit=5"],
      ["wo_variations", `select=id&work_order_id=eq.${shared!.workOrderId}`],
      ["wo_events", `select=id&work_order_id=eq.${shared!.workOrderId}`],
      ["painter_status", "select=painter_id&limit=5"],
    ] as const) {
      expect(await readAs(workerToken, table, q), `${table} is shut to a worker`).toEqual([]);
    }
    expect((await readAs(workerToken, "wo_surfaces", `select=id&work_order_id=eq.${shared!.workOrderId}`)).length).toBeGreaterThan(0);
    expect(await readAs(workerToken, "wo_surfaces", `select=id&work_order_id=eq.${other!.workOrderId}`)).toEqual([]);
    const mine = await fetch(`${URL}/rest/v1/rpc/worker_jobs`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_work_order_id: null }) }).then((r) => r.json());
    expect(Array.isArray(mine) ? mine.map((j: { work_order_id: string }) => j.work_order_id) : mine).toEqual([shared!.workOrderId]);
    const keys = JSON.stringify(mine);
    expect(keys).not.toMatch(/cents|payment|price/i);
  });

  test("as the contractor: remove the worker — locked out at once", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/jobs");
    page.once("dialog", (d) => d.accept());
    await page.getByTestId(`worker-remove-${contractorUserId}`).click();
    await expect(page.getByTestId("workers-message")).toContainText("Removed", { timeout: 20_000 });
    const { data } = await db!.from("contractor_users").select("removed_at").eq("id", contractorUserId).single();
    expect((data as { removed_at: string | null }).removed_at).toBeTruthy();
    // The same session the worker already held: nothing opens any more.
    expect(await readAs(workerToken, "wo_surfaces", `select=id&work_order_id=eq.${shared!.workOrderId}`)).toEqual([]);
    const mine = await fetch(`${URL}/rest/v1/rpc/worker_jobs`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_work_order_id: null }) }).then((r) => r.json());
    expect(mine).toEqual([]);
  });
});
