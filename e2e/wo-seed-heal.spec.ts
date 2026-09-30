import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * 87 Trenerry Crescent (1 Oct 2026): two rows a signed variation added were
 * the ONLY rows on the tick list, so the office page's "no rows → seed from
 * the job sheet" heal never ran and the six rooms on the sheet were never
 * seeded. The heal now runs whenever no row from the job sheet exists.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
let fixture: LoopFixture | null = null;

test.describe("the tick list heals around variation rows", () => {
  test.skip(!db || !staff || !contractor, missingCreds("STAFF"));

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Kitchen Living", labels: ["Walls"] },
      { heading: "Bedroom", labels: ["Ceiling"] },
    ]);
    // The Trenerry state: the job sheet's rows gone, one row that did not come
    // from the sheet (a variation's — no surface_key) sitting there alone.
    await db!.from("wo_surfaces").delete().eq("work_order_id", fixture.workOrderId);
    const { error } = await db!.from("wo_surfaces").insert({
      work_order_id: fixture.workOrderId, heading: "Stairwell", label: "Skirting Boards", surface_key: null, sort: 900,
    });
    if (error) throw new Error(error.message);
  });
  test.afterAll(async () => { await destroyLoopFixture(db!, fixture); });

  test("opening the job in the console seeds the sheet's rooms beside the variation row", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);
    await expect(page.getByTestId("tick-list")).toBeVisible({ timeout: 30_000 });
    const list = page.getByTestId("tick-list");
    await expect(list).toContainText("Kitchen Living");
    await expect(list).toContainText("Bedroom");
    await expect(list).toContainText("Stairwell");
    const { data } = await db!.from("wo_surfaces").select("heading, surface_key").eq("work_order_id", fixture!.workOrderId);
    const rows = (data ?? []) as { heading: string; surface_key: string | null }[];
    expect(rows.filter((r) => r.surface_key).map((r) => r.heading).sort()).toEqual(["Bedroom", "Kitchen Living"]);
    expect(rows.some((r) => r.heading === "Stairwell")).toBe(true);
  });
});
