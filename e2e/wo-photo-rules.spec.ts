import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 24 Sep 2026 — "Photos not required" on ONE line of the scope (a fuel
 * allowance), migration 20270198: the office sets it from the PC job page; the
 * painter's tick on that row needs no before or finished shot, and the
 * heading's gates are counted over the rows that still need photos. Every
 * area still needs its own before and finished shot (Tom, 25 Sep — the
 * short-job rule was reverted, 20270200).
 *
 * The gate is wo_tick_surface's; the ticks here are the painter's own RPC
 * calls. Photo rows are inserted by the fixture (the gate reads rows).
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let lines: LoopFixture | null = null;

const photo = (workOrderId: string, kind: "before" | "completion", area: string) =>
  db!.from("wo_photos").insert({
    work_order_id: workOrderId, kind, area,
    storage_path: `wo/${workOrderId}/${kind}-${area}-${Date.now()}.jpg`,
  });
const surfaceId = (f: LoopFixture, label: string) => f.surfaces.find((s) => s.label === label)!.id;

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
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, lines); });

  test("the office marks a line 'photos not required' on the PC job page", async ({ page }) => {
    const fuel = surfaceId(lines!, "Fuel allowance");
    await signIn(page, staff!, /\/(home|estimates)/);
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
});
