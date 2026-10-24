import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, customerIdForEmail, destroyLoopFixture, accessTokenFor,
  serviceClient, type LoopFixture,
} from "./fixtures/woLoop";
import { deleteUserByEmail, magicLinkFor, openMagicLink } from "./fixtures/portal";

/**
 * Work order UX Step 2 — the Customer updates queue and the surface milestones.
 *
 * AS THE PAINTER (the trigger): a bulk tap that completes a surface drafts ONE
 * milestone; a second surface inside the bundle window joins the same draft;
 * the same surface painted later is a second draft; a paused job drafts
 * nothing; a dropped draft is never regenerated.
 * AS PC: the queue shows the switch (off), the kinds, send / edit-then-send /
 * drop. Nothing is sent while the switch is off.
 * AS THE CUSTOMER: the sent entry appears with the sender line and ONE Reply
 * button for the whole timeline; a customer session cannot read a draft.
 */

const painter = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let fixture: LoopFixture | null = null;
let accountId = "";
const run = randomBytes(4).toString("hex");
const portalEmail = `pg.e2e.updates.${run}@example.com`;
const ROOMS = ["Bed 1", "Bed 2"];

type UpdateRow = { id: string; kind: string; status: string; draft_text: string; final_text: string | null; milestones: unknown; created_at: string; sender_name: string | null };

async function updates(kind?: string): Promise<UpdateRow[]> {
  let q = db!.from("wo_updates").select("id, kind, status, draft_text, final_text, milestones, created_at, sender_name")
    .eq("work_order_id", fixture!.workOrderId).order("created_at");
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as UpdateRow[];
}

/** The draft hook rides behind the server action's response (`after`) — give it a moment. */
async function waitForMilestones(n: number): Promise<UpdateRow[]> {
  for (let i = 0; i < 40; i++) {
    const rows = await updates("surface_milestone");
    if (rows.length >= n) return rows;
    await new Promise((r) => setTimeout(r, 500));
  }
  return updates("surface_milestone");
}

async function openAsPainter(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, painter!, /\/portal/);
  await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
  await expect(page.getByTestId("tick-list")).toHaveAttribute("data-view", "surface");
}

async function readAs(who: { email: string; password: string }, path: string): Promise<{ rows: unknown[] | null; status: number }> {
  const token = await accessTokenFor(who);
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => null);
  return { rows: Array.isArray(body) ? body : null, status: res.status };
}

test.describe("customer updates queue — surface milestones", () => {
  test.skip(!painter || !staff || !customer, missingCreds("CUSTOMER"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, painter!.email);
    if (!contractorId) throw new Error(`no contractors row for ${painter!.email}`);
    const customerId = await customerIdForEmail(db!, customer!.email);
    expect(customerId, "the E2E customer needs a customers row").toBeTruthy();

    fixture = await createLoopFixture(db!, contractorId,
      ROOMS.map((heading) => ({ heading, labels: ["Ceilings", "Walls", "Skirting Boards"] })), customerId);
    const assign = await db!.rpc("wo_surface_groups_assign", { p_work_order_id: fixture.workOrderId });
    if (assign.error) throw new Error(assign.error.message);
    expect(Number(assign.data)).toBe(6);

    // The customer: a name for the greeting, and a portal account for the timeline.
    const acct = await db!.from("accounts").insert({ email: portalEmail, name: "Amanda Hughes" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id;
    const est = await db!.from("estimates").update({ accepted_name: "Amanda Hughes", account_id: accountId, title: "14 Clarke St" }).eq("id", fixture.estimateId);
    if (est.error) throw new Error(est.error.message);
    // The before photo, so ticks are allowed.
    await db!.from("wo_photos").insert({ work_order_id: fixture.workOrderId, kind: "before", area: "Bed 1", storage_path: `wo/${fixture.workOrderId}/e2e-before.jpg` });
    // The switch starts OFF for this run whatever the project was left at.
    const { data: m } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    const saved = (m?.value as { controls?: Record<string, { mode?: string }> } | null) ?? {};
    const controls = { ...(saved.controls ?? {}), customer_updates_queue: { ...(saved.controls?.customer_updates_queue ?? {}), mode: "approve" } };
    await db!.from("settings").upsert({ key: "messaging", value: { ...saved, controls } }, { onConflict: "key" });
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
    if (accountId) {
      await db!.from("account_users").delete().eq("account_id", accountId);
      await db!.from("accounts").delete().eq("id", accountId);
    }
    await deleteUserByEmail(db!, portalEmail);
  });

  test("a bulk tap that completes a surface creates exactly one milestone draft, in the brief's words", async ({ page }) => {
    await openAsPainter(page);
    await page.getByTestId("group-prep-walls").click();
    await expect(page.getByTestId("bulk-toast")).toContainText("2 walls marked prepped");

    const rows = await waitForMilestones(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("drafted");
    expect(rows[0].milestones).toEqual([{ group: "walls", state: "prepped" }]);
    expect(rows[0].draft_text).toBe("Hi Amanda, all the walls are prepped now so painting on those starts next.");
  });

  test("a second surface inside the bundle window joins the same draft (six ticks, one message)", async ({ page }) => {
    await openAsPainter(page);
    await page.getByTestId("group-prep-ceilings").click();
    await expect(page.getByTestId("bulk-toast")).toContainText("2 ceilings marked prepped");

    // Still one draft — now about both.
    await new Promise((r) => setTimeout(r, 2500));
    const rows = await updates("surface_milestone");
    expect(rows).toHaveLength(1);
    expect(rows[0].milestones).toEqual([{ group: "walls", state: "prepped" }, { group: "ceilings", state: "prepped" }]);
    expect(rows[0].draft_text).toBe("Hi Amanda, walls and ceilings are both prepped now so painting on those starts next.");
  });

  test("the same surface painted after the window is a second draft; prepped is never re-announced", async ({ page }) => {
    // Age the open draft past the window.
    const [first] = await updates("surface_milestone");
    await db!.from("wo_updates").update({ created_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq("id", first.id);

    await openAsPainter(page);
    await page.getByTestId("group-paint-walls").click();
    await expect(page.getByTestId("bulk-toast")).toContainText("2 walls marked painted");

    const rows = await waitForMilestones(2);
    expect(rows).toHaveLength(2);
    expect(rows[1].milestones).toEqual([{ group: "walls", state: "done" }]);
    // Ceilings are prepped but not painted → named as what is up next.
    expect(rows[1].draft_text).toBe("Hi Amanda, walls are painted right through the house. Ceilings are up next.");
  });

  test("a paused job drafts nothing", async ({ page }) => {
    await db!.from("work_orders").update({ blocked_reason: "Customer away — paused" }).eq("id", fixture!.workOrderId);
    await openAsPainter(page);
    await page.getByTestId("group-prep-trims").click();
    await expect(page.getByTestId("bulk-toast")).toContainText("2 doors, frames & skirting marked prepped");
    await new Promise((r) => setTimeout(r, 2500));
    expect(await updates("surface_milestone")).toHaveLength(2);
    await db!.from("work_orders").update({ blocked_reason: null }).eq("id", fixture!.workOrderId);
  });

  test("nothing is sent while the switch is off, even when the sweep runs", async ({ request }) => {
    test.skip(!SECRET, "set CRON_SECRET");
    const res = await request.get("/api/cron/campaign-sweep?only=updates", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.status()).toBe(200);
    const body = await res.json() as { customerUpdates?: { on: boolean; sent: number } };
    expect(body.customerUpdates?.on).toBe(false);
    expect(body.customerUpdates?.sent).toBe(0);
    expect((await updates()).every((u) => u.status === "drafted")).toBe(true);
  });

  test("PC: the queue shows the switch off, the kinds, and sends one draft to the timeline edited", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/updates");
    await expect(page.getByTestId("auto-send-switch")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("updates-waiting")).toContainText("Waiting to send");

    const [first, second] = await updates("surface_milestone");
    const card = page.getByTestId(`update-${second.id}`);
    await expect(card.getByTestId(`kind-${second.id}`)).toHaveText("Surface milestone");
    await expect(card.getByTestId(`to-${second.id}`)).toContainText("To Amanda Hughes · from ");
    await expect(card.getByTestId(`send-${second.id}`)).toHaveText("Send to timeline");

    // Edit, then send.
    await card.getByTestId(`edit-toggle-${second.id}`).click();
    await card.getByTestId(`edit-${second.id}`).fill("Hi Amanda, walls are painted right through the house. Ceilings are up next — Thursday, all going well.");
    await card.getByTestId(`send-${second.id}`).click();
    await expect(card.getByTestId(`sent-${second.id}`)).toBeVisible();
    const sent = (await updates("surface_milestone")).find((u) => u.id === second.id)!;
    expect(sent.status).toBe("sent");
    expect(sent.final_text).toContain("Thursday, all going well");
    expect((sent.sender_name ?? "").length).toBeGreaterThan(0);

    // Drop the first (the prepped bundle).
    const other = page.getByTestId(`update-${first.id}`);
    await other.getByTestId(`delete-${first.id}`).click();
    await other.getByTestId(`delete-${first.id}`).click();
    await expect(other.getByTestId(`deleted-${first.id}`)).toBeVisible();
    expect((await updates("surface_milestone")).map((u) => u.id)).toEqual([second.id]);
  });

  test("a dropped milestone is never regenerated for the same surfaces", async ({ page }) => {
    // Ceilings (prepped, announced in the dropped draft): tap a room round and back to prepped.
    await openAsPainter(page);
    await page.getByTestId("tick-view-room").click();
    const c1 = fixture!.surfaces.find((s) => s.label === "Ceilings")!;
    const row = page.getByTestId(`tick-${c1.id}`);
    await row.click();                      // prepped → done
    await expect(row).toContainText("Done");
    await row.click();                      // done → todo
    await expect(row).toContainText("To do");
    await row.click();                      // todo → prepped: ceilings 100% prepped again
    await expect(row).toContainText("Prepped");
    await new Promise((r) => setTimeout(r, 2500));
    const rows = await updates("surface_milestone");
    expect(rows.map((u) => u.milestones)).not.toContainEqual([{ group: "ceilings", state: "prepped" }]);
    expect(rows).toHaveLength(1);
  });

  test("CUSTOMER: the sent entry shows the sender line without the greeting, with ONE Reply button; drafts are unreadable", async ({ page }) => {
    await openMagicLink(page, await magicLinkFor(db!, portalEmail));
    await page.goto("/account/project");
    const sent = (await updates("surface_milestone"))[0];
    const item = page.locator(".tl-item", { hasText: "Thursday, all going well" });
    await expect(item).toBeVisible();
    await expect(item.locator("h3")).toContainText(`${sent.sender_name}, `);
    await expect(item).not.toContainText("Hi Amanda");
    await expect(item).toContainText("Walls are painted right through the house.");
    const reply = page.getByTestId("message-coordinator");
    await expect(reply).toHaveCount(1);
    await expect(reply).toHaveText(`Reply to ${sent.sender_name}`);

    // RLS: through the customer's own session, drafts are not there; the sent row is.
    const drafts = await readAs(customer!, `wo_updates?select=id,status&work_order_id=eq.${fixture!.workOrderId}&status=eq.drafted`);
    expect(drafts.rows).toEqual([]);
    const sentRows = await readAs(customer!, `wo_updates?select=id,status&work_order_id=eq.${fixture!.workOrderId}&status=eq.sent`);
    expect(sentRows.rows?.length).toBeGreaterThan(0);
  });
});
