import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, rpcAsJson, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 24 Sep 2026 — two photo rules on the tick list (migration 20270198):
 *
 *   · "Photos not required" on ONE line of the scope (a fuel allowance): the
 *     office sets it from the PC job page; the painter's tick on that row
 *     needs no before or finished shot, and the heading's gates are counted
 *     over the rows that still need photos;
 *   · a job of three booked days or fewer needs ONE before and ONE finished
 *     photo for the whole job, not one per area.
 *
 * The gate is wo_tick_surface's; the ticks here are the painter's own RPC
 * calls. Photo rows are inserted by the fixture (the gate reads rows).
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let lines: LoopFixture | null = null;
let shortJob: LoopFixture | null = null;
let longJob: LoopFixture | null = null;

const photo = (workOrderId: string, kind: "before" | "completion", area: string) =>
  db!.from("wo_photos").insert({
    work_order_id: workOrderId, kind, area,
    storage_path: `wo/${workOrderId}/${kind}-${area}-${Date.now()}.jpg`,
  });
const surfaceId = (f: LoopFixture, label: string) => f.surfaces.find((s) => s.label === label)!.id;
const melbourne = (plusDays: number) => {
  const d = new Date(Date.now() + plusDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
};

test.describe.configure({ mode: "serial" });

test.describe("photo rules on the tick list", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture jobs");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    lines = await createLoopFixture(db!, contractorId!, [
      { heading: "Allowances", labels: ["Fuel allowance"] },
      { heading: "Front", labels: ["Walls", "Windows"] },
    ]);
    shortJob = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls"] }, { heading: "Left", labels: ["Eaves"] },
    ]);
    longJob = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls"] }, { heading: "Left", labels: ["Eaves"] },
    ]);
    // Booked spans: three days → one shot for the job; six days → per area.
    await db!.from("work_orders").update({ start_date: melbourne(0), end_date: melbourne(2) }).eq("id", shortJob.workOrderId);
    await db!.from("work_orders").update({ start_date: melbourne(0), end_date: melbourne(5) }).eq("id", longJob.workOrderId);
  });

  test.afterAll(async () => {
    for (const f of [lines, shortJob, longJob]) await destroyLoopFixture(db!, f);
  });

  test("the office marks a line 'photos not required' on the PC job page", async ({ page }) => {
    const fuel = surfaceId(lines!, "Fuel allowance");
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${lines!.workOrderId}`);
    await page.getByTestId(`photos-optional-${fuel}`).click();
    await expect(page.getByTestId(`no-photos-${fuel}`)).toBeVisible({ timeout: 30_000 });
    const { data } = await db!.from("wo_surfaces").select("photos_optional").eq("id", fuel).single();
    expect((data as { photos_optional: boolean }).photos_optional).toBe(true);
    // Staff only: the painter cannot waive their own photos.
    expect(await rpcAs(contractor!, "wo_set_surface_photos_optional", { p_surface_id: fuel, p_optional: false })).toBe("error:not_staff");
  });

  test("an optional line ticks without a photo; the photo rows keep their gates", async () => {
    const id = lines!.workOrderId;
    const fuel = surfaceId(lines!, "Fuel allowance");
    const walls = surfaceId(lines!, "Walls");
    const windows = surfaceId(lines!, "Windows");

    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: fuel, p_to: "prepped" })).toBe("ok:prepped");
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: fuel, p_to: "done" })).toBe("ok:done");
    // Front still wants its before shot.
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: walls, p_to: "prepped" })).toBe("error:before_photo_required:Front");

    // Windows is not a surface either, says the office — Front's photo rows are Walls alone.
    expect(await rpcAs(staff!, "wo_set_surface_photos_optional", { p_surface_id: windows, p_optional: true })).toBe("ok:true");
    await photo(id, "before", "Front");
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: walls, p_to: "prepped" })).toBe("ok:prepped");
    // Walls done completes Front's photo rows → the finished shot is due first.
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: walls, p_to: "done" })).toBe("error:after_photo_required:Front");
    // Windows (optional) is never gated, whatever the state of the heading.
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: windows, p_to: "done" })).toBe("ok:done");
    await photo(id, "completion", "Front");
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: walls, p_to: "done" })).toBe("ok:done");
  });

  test("three booked days or fewer: one before shot anywhere covers every area", async () => {
    const id = shortJob!.workOrderId;
    expect(await rpcAsJson<string>(staff!, "wo_photo_scope", { p_work_order_id: id })).toBe("job");
    const eaves = surfaceId(shortJob!, "Eaves");
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: eaves, p_to: "prepped" })).toBe("error:before_photo_required:Left");
    // One shot, taken on Front — Left is covered too.
    await photo(id, "before", "Front");
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: eaves, p_to: "prepped" })).toBe("ok:prepped");
    // One finished shot, likewise.
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: eaves, p_to: "done" })).toBe("error:after_photo_required:Left");
    await photo(id, "completion", "Front");
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: eaves, p_to: "done" })).toBe("ok:done");
    const walls = surfaceId(shortJob!, "Walls");
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: walls, p_to: "done" })).toBe("ok:done");
  });

  test("a longer job keeps one before and one finished shot per area", async () => {
    const id = longJob!.workOrderId;
    expect(await rpcAsJson<string>(staff!, "wo_photo_scope", { p_work_order_id: id })).toBe("area");
    await photo(id, "before", "Front");
    const eaves = surfaceId(longJob!, "Eaves");
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: eaves, p_to: "prepped" })).toBe("error:before_photo_required:Left");
    await photo(id, "before", "Left");
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: eaves, p_to: "prepped" })).toBe("ok:prepped");
  });
});
