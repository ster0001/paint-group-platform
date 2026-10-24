import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, rpcAsJson,
  serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Work order UX Step 1 — the By surface view, driven AS THE PAINTER on a phone
 * (both themes) and AS PC in the office mirror.
 *
 * What only a run can prove: that one bulk tap writes exactly the per-room rows
 * a loop of single taps writes (R4), skips rooms already there (R5), refuses
 * Painted until every room is Prepped (R3) on the SERVER, fails whole on the
 * before-photo gate with nothing written, and that Undo puts those rows back
 * (R6). The job is a throwaway fixture; its labels are rate-card codes so the
 * one resolver (wo_surface_groups_assign) groups them: Ceilings → ceilings,
 * Walls → walls, Skirting Boards → trims.
 */

const creds = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
const ROOMS = ["Bed 1", "Bed 2", "Bed 3"];
const PHONE = { width: 390, height: 844 };

type TickEvent = { id: string; type: string; actor_kind: string; created_at: string; meta: Record<string, unknown> };

async function events(type?: string): Promise<TickEvent[]> {
  let q = db!.from("wo_events").select("id, type, actor_kind, created_at, meta")
    .eq("work_order_id", fixture!.workOrderId).order("created_at", { ascending: true });
  if (type) q = q.eq("type", type);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as TickEvent[];
}

async function states(label: string): Promise<string[]> {
  const { data, error } = await db!.from("wo_surfaces").select("heading, state")
    .eq("work_order_id", fixture!.workOrderId).eq("label", label).order("sort");
  if (error) throw new Error(error.message);
  return (data as { state: string }[]).map((r) => r.state);
}

async function openAsPainter(page: Page) {
  await page.setViewportSize(PHONE);
  await signIn(page, creds!, /\/portal/);
  await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
  await expect(page.getByTestId("tick-list")).toBeVisible();
}

test.describe("work order ticks — By surface", () => {
  test.skip(!creds, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, creds!.email);
    if (!contractorId) throw new Error(`no contractors row for ${creds!.email}`);
    fixture = await createLoopFixture(db!, contractorId,
      ROOMS.map((heading) => ({ heading, labels: ["Ceilings", "Walls", "Skirting Boards"] })));
    // The fixture inserts rows directly (not through wo_seed_surfaces), so the
    // resolver is run the way the seeder runs it. Service role may call helpers.
    const { data, error } = await db!.rpc("wo_surface_groups_assign", { p_work_order_id: fixture.workOrderId });
    if (error) throw new Error(`assign: ${error.message}`);
    expect(Number(data)).toBe(9);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
  });

  test("the painter lands on By surface: one row per surface, painted locked until prepped (R2, R3)", async ({ page }) => {
    await openAsPainter(page);
    const list = page.getByTestId("tick-list");
    await expect(list).toHaveAttribute("data-view", "surface");
    await expect(page.getByTestId("tick-view-surface")).toHaveAttribute("aria-selected", "true");

    for (const code of ["ceilings", "walls", "trims"]) {
      await expect(page.getByTestId(`group-summary-${code}`)).toContainText("0 of 3 prepped");
      await expect(page.getByTestId(`group-prep-${code}`)).toHaveText("Mark all prepped");
      await expect(page.getByTestId(`group-paint-${code}`)).toBeDisabled();
    }
    await expect(page.getByTestId("group-trims")).toContainText("Doors, frames & skirting");
    // No whole-job button anywhere (R1).
    await expect(list.getByRole("button", { name: /mark everything|all surfaces|whole job/i })).toHaveCount(0);

    // Tapping the row shows every room.
    await page.getByTestId("group-head-walls").click();
    const rooms = page.getByTestId("group-rooms-walls");
    for (const r of ROOMS) await expect(rooms).toContainText(`${r} not started`);
  });

  test("no before photo: the screen says Step 1 first, and the SERVER refuses the whole call with nothing written", async ({ page }) => {
    await openAsPainter(page);
    await expect(page.getByTestId("tick-locked")).toBeVisible();
    await page.getByTestId("group-prep-walls").click();
    await expect(page.getByTestId("tick-message")).toContainText("Step 1 first");

    const result = await rpcAsJson<{ error?: string }>(creds!, "wo_tick_surface_group",
      { p_work_order_id: fixture!.workOrderId, p_group_code: "walls", p_to: "prepped" });
    expect(result.error).toBe("before_photo_required:job");
    expect(await states("Walls")).toEqual(["todo", "todo", "todo"]);
    expect(await events("surface_tick")).toHaveLength(0);
    expect(await events("surface_group_ticked")).toHaveLength(0);
  });

  test("R3 on the server: Painted is refused while a room is still to do", async () => {
    await db!.from("wo_photos").insert({
      work_order_id: fixture!.workOrderId, kind: "before", area: "Bed 1",
      storage_path: `wo/${fixture!.workOrderId}/e2e-before.jpg`,
    });
    const result = await rpcAsJson<{ error?: string }>(creds!, "wo_tick_surface_group",
      { p_work_order_id: fixture!.workOrderId, p_group_code: "walls", p_to: "done" });
    expect(result.error).toBe("not_all_prepped");
    expect(await events("surface_tick")).toHaveLength(0);
  });

  test("one tap marks every room prepped, with a toast and Undo that puts exactly those rows back (R4, R6)", async ({ page }) => {
    await openAsPainter(page);
    await expect(page.getByTestId("tick-locked")).toHaveCount(0);

    await page.getByTestId("group-prep-walls").click();
    const toast = page.getByTestId("bulk-toast");
    await expect(toast).toContainText("3 walls marked prepped");
    await expect(page.getByTestId("group-prep-walls")).toHaveText("✓ Prepped");
    await expect(page.getByTestId("group-paint-walls")).toBeEnabled();
    expect(await states("Walls")).toEqual(["prepped", "prepped", "prepped"]);

    // R6: Undo — inside its six seconds (the event checks come after; the log keeps them).
    await page.getByTestId("bulk-undo").click();
    await expect(page.getByTestId("tick-message")).toContainText("3 rooms put back");
    await expect(page.getByTestId("group-prep-walls")).toHaveText("Mark all prepped");
    await expect(page.getByTestId("group-paint-walls")).toBeDisabled();
    expect(await states("Walls")).toEqual(["todo", "todo", "todo"]);

    // R4: three per-room tick rows, each the shape the single tick writes, plus one parent.
    const ticks = (await events("surface_tick")).filter((t) => !t.meta.undo_of);
    expect(ticks).toHaveLength(3);
    const parents = await events("surface_group_ticked");
    expect(parents).toHaveLength(1);
    const parent = parents[0];
    expect(parent.meta).toMatchObject({ group_code: "walls", target_state: "prepped", count: 3 });
    expect((parent.meta.child_event_ids as string[]).sort()).toEqual(ticks.map((t) => t.id).sort());
    for (const t of ticks) {
      expect(t.actor_kind).toBe("contractor");
      expect(t.meta).toMatchObject({ label: "Walls", from: "todo", to: "prepped", bulk_event_id: parent.id });
    }
    const unticks = await events("surface_group_untick");
    expect(unticks).toHaveLength(1);
    expect(unticks[0].meta).toMatchObject({ parent_event_id: parent.id, count: 3 });
    // Undo is itself three by-hand ticks back, so today's draft re-reads correctly.
    expect((await events("surface_tick")).filter((t) => t.meta.undo_of)).toHaveLength(3);

    // A second undo of the same tap does nothing more.
    const again = await rpcAsJson<{ ok?: boolean; already?: boolean }>(creds!, "wo_untick_bulk", { p_parent_event_id: parent.id });
    expect(again).toMatchObject({ ok: true, already: true });
  });

  test("golden: a bulk tap writes the rows a loop of single ticks writes — and skips rooms already there (R5)", async () => {
    // Walls in one tap; Ceilings one room at a time, as the same painter.
    const bulk = await rpcAsJson<{ ok?: boolean; count?: number; surface_ids?: string[] }>(creds!, "wo_tick_surface_group",
      { p_work_order_id: fixture!.workOrderId, p_group_code: "walls", p_to: "prepped" });
    expect(bulk.ok).toBe(true);
    expect(bulk.count).toBe(3);

    const ceilings = fixture!.surfaces.filter((s) => s.label === "Ceilings");
    for (const s of ceilings) {
      expect(await rpcAs(creds!, "wo_tick_surface", { p_surface_id: s.id, p_to: "prepped" })).toBe("ok:prepped");
    }

    const all = await events("surface_tick");
    const fresh = all.filter((t) => !t.meta.undo_of).slice(-6); // after the undone round
    const wallTicks = fresh.filter((t) => t.meta.label === "Walls");
    const ceilingTicks = fresh.filter((t) => t.meta.label === "Ceilings");
    expect(wallTicks).toHaveLength(3);
    expect(ceilingTicks).toHaveLength(3);
    const shape = (t: TickEvent) => {
      const m = { ...t.meta }; delete m.bulk_event_id; delete m.surface_id;
      return { kind: t.actor_kind, ...m };
    };
    // Same keys, same from/to, same actor; only the label (and the surface id) differ.
    expect(wallTicks.map(shape)).toEqual(ceilingTicks.map(shape).map((s) => ({ ...s, label: "Walls" })));
    expect(Object.keys(wallTicks[0].meta).filter((k) => k !== "bulk_event_id").sort())
      .toEqual(Object.keys(ceilingTicks[0].meta).sort());
    expect(await states("Walls")).toEqual(await states("Ceilings"));

    // R5: the same tap again moves nothing and writes nothing.
    const before = (await events()).length;
    const repeat = await rpcAsJson<{ ok?: boolean; count?: number; parent_event_id?: string | null }>(creds!, "wo_tick_surface_group",
      { p_work_order_id: fixture!.workOrderId, p_group_code: "walls", p_to: "prepped" });
    expect(repeat).toMatchObject({ ok: true, count: 0, parent_event_id: null });
    expect((await events()).length).toBe(before);
  });

  test("Mark all painted, the light theme, and By room remembered (R2)", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "crm_theme", value: "light", url: baseURL! }]);
    await openAsPainter(page);
    await expect(page.locator(".pt")).toHaveAttribute("data-theme", "light");

    await expect(page.getByTestId("group-summary-walls")).toContainText("0 of 3 painted");
    await page.getByTestId("group-paint-walls").click();
    await expect(page.getByTestId("bulk-toast")).toContainText("3 walls marked painted");
    await expect(page.getByTestId("group-paint-walls")).toHaveText("✓ Painted");
    await expect(page.getByTestId("group-summary-walls")).toContainText("3 of 3 painted");
    expect(await states("Walls")).toEqual(["done", "done", "done"]);
    await expect(page.getByTestId("tick-progress")).toHaveText("3 / 9");

    // By room is one tap away and shows the same ticks.
    await page.getByTestId("tick-view-room").click();
    await expect(page.getByTestId("tick-list")).toHaveAttribute("data-view", "room");
    const wall1 = fixture!.surfaces.find((s) => s.label === "Walls")!;
    await expect(page.getByTestId(`tick-${wall1.id}`)).toContainText("Done");
    await page.reload();
    await expect(page.getByTestId("tick-list")).toHaveAttribute("data-view", "room");
    await page.getByTestId("tick-view-surface").click();
    await expect(page.getByTestId("tick-list")).toHaveAttribute("data-view", "surface");
  });

  test("PC ticks the same way in the mirror, recorded as staff", async ({ page }) => {
    test.skip(!staff, missingCreds("STAFF"));
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}/as-contractor`);
    await expect(page.getByTestId("tick-list")).toHaveAttribute("data-view", "surface");
    // Ceilings were prepped room by room above — painted is open.
    await page.getByTestId("group-paint-ceilings").click();
    await expect(page.getByTestId("bulk-toast")).toContainText("3 ceilings marked painted");
    expect(await states("Ceilings")).toEqual(["done", "done", "done"]);
    const parents = await events("surface_group_ticked");
    expect(parents[parents.length - 1].actor_kind).toBe("staff");
    expect(parents[parents.length - 1].meta).toMatchObject({ group_code: "ceilings", target_state: "done", count: 3 });

    // The console page itself has the view too.
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);
    await expect(page.getByTestId("tick-view")).toBeVisible();
  });
});
