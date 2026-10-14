import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 14 Oct 2026 — "in the work order for contractors, please update to
 * make it clearer on the number of doors, windows etc per room".
 *
 *  · the painter's sheet (anonymous, by token) says "Doors × 4" beside a
 *    counted row — and "× 1" too, because "Doors" alone is the ambiguity —
 *    while a measured surface (Walls) carries no number;
 *  · the painter's tick list on the job page shows the same count on the row,
 *    read off the frozen document by surface key — the row's label itself
 *    stays the bare substrate.
 */
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let f: LoopFixture | null = null;
let shareToken = "";
let doorsRowId = "";
let wallsRowId = "";

test.describe("Work order — how many doors and windows per room", () => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    f = await createLoopFixture(db!, cid, [{ heading: "Bedroom 1", labels: ["Walls", "Doors", "Windows", "Front door"] }]);
    doorsRowId = f.surfaces.find((s) => s.label === "Doors")!.id;
    wallsRowId = f.surfaces.find((s) => s.label === "Walls")!.id;
    const { data, error } = await db!.from("work_orders").select("share_token, wo_snapshot").eq("id", f.workOrderId).single();
    if (error) throw new Error(`fixture: ${error.message}`);
    const row = data as { share_token: string; wo_snapshot: { areas: Array<{ surfaces: Array<{ label: string }> }> } };
    shareToken = row.share_token;
    const counts: Record<string, number> = { Doors: 4, Windows: 2, "Front door": 1 };
    const { error: upErr } = await db!.from("work_orders").update({
      wo_snapshot: {
        ...row.wo_snapshot,
        areas: row.wo_snapshot.areas.map((a) => ({
          ...a,
          surfaces: a.surfaces.map((s) => (counts[s.label] ? { ...s, count: counts[s.label] } : s)),
        })),
      },
    }).eq("id", f.workOrderId);
    if (upErr) throw new Error(`fixture snapshot: ${upErr.message}`);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, f); });

  test("the painter's sheet: every counted row says how many, a measured one says nothing", async ({ page }) => {
    await page.goto(`/w/${shareToken}`);
    await expect(page.getByTestId("surf-count-a0:1")).toHaveText("× 4");
    await expect(page.getByTestId("surf-count-a0:2")).toHaveText("× 2");
    await expect(page.getByTestId("surf-count-a0:3")).toHaveText("× 1");
    await expect(page.getByTestId("surf-count-a0:0")).toHaveCount(0);
    const doors = page.locator(".surf", { hasText: "Doors" }).first();
    await expect(doors.locator(".surf-name")).toHaveText(/^Doors\s*× 4$/);
  });

  test("the painter's tick list carries the count on the row, not in its label", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${f!.workOrderId}`);
    await expect(page.getByTestId(`tick-count-${doorsRowId}`)).toHaveText("× 4");
    await expect(page.getByTestId(`tick-count-${wallsRowId}`)).toHaveCount(0);
    await expect(page.getByTestId(`tick-${doorsRowId}`)).toHaveAttribute("aria-label", /^Doors × 4 — /);
    // The stored label is untouched — standards and variation rows match on it.
    const { data } = await db!.from("wo_surfaces").select("label").eq("id", doorsRowId).single();
    expect(data?.label).toBe("Doors");
  });
});
