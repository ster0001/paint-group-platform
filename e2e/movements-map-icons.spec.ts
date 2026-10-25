import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Movements map — the icon ladder (Tom, 25 Oct 2026: "update all of the icons depending on
 * the stage of the job, so it is clear what the most important things to do on the job are").
 *
 *   As the PC in the browser, on Google Maps:
 *     1. a job on site with a paint chip in the tray is an amber paint tin (the move rung);
 *     2. once its painter asks for a materials pickup overdue — the office marks a placed
 *        chip's day as yesterday — the icon is a red warning and the hover list names both,
 *        the overdue movement first, with "2" on the corner;
 *     3. the legend names the six rungs.
 *
 * Needs NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY in the app's build — skips, loudly, without it
 * (the Map tab does not exist without the key).
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";
const RUN = Math.random().toString(36).slice(2, 8);
const JOB_POINT = { lat: -37.91, lng: 145.09 };

const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
function addDays(iso: string, n: number): string { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const TODAY = melbourne.format(new Date());

let contractorId = "";
let job: LoopFixture | null = null;
let settingsBefore: unknown = undefined;
let settingsExisted = false;

const jobPin = (page: Page) => page.locator(`[data-testid="map-job"][data-job-id="${job!.workOrderId}"]`);
async function openMap(page: Page) {
  await page.goto("/pc/movements?view=map");
  await expect(page.getByTestId("map-legend")).toBeVisible({ timeout: 20_000 });
}

test.describe("movements map — the icon ladder", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");
  test.skip(!MAPS_KEY, "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is not in the test env — the Map tab does not exist without it");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    const { data: s } = await db!.from("settings").select("value").eq("key", "movements").maybeSingle();
    settingsExisted = Boolean(s);
    settingsBefore = s?.value ?? null;
    const base = (settingsBefore && typeof settingsBefore === "object" ? settingsBefore : {}) as Record<string, unknown>;
    const { error: sErr } = await db!.from("settings").upsert({
      key: "movements", value: { ...base, warehouse: { label: "Warehouse", address: "25-27 Bunney Rd", suburb: "Oakleigh South", postcode: "3167", lat: -37.92, lng: 145.1 } },
    }, { onConflict: "key" });
    if (sErr) throw new Error(`settings: ${sErr.message}`);

    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", job.workOrderId).single();
    const snap = { ...((w as { wo_snapshot: Record<string, unknown> }).wo_snapshot), jobAddress: `${RUN} Ladder St, Oakleigh South VIC 3167`, jobTitle: `E2E Map Icons ${RUN}` };
    const { error: uErr } = await db!.from("work_orders").update({
      wo_snapshot: snap, stage: "in_progress", start_date: addDays(TODAY, -3), end_date: addDays(TODAY, 3), lat: JOB_POINT.lat, lng: JOB_POINT.lng, point_checked_at: new Date().toISOString(),
    }).eq("id", job.workOrderId);
    if (uErr) throw new Error(`fixture update: ${uErr.message}`);
    // A paint chip in the tray: the job needs something to move.
    const made = await rpcAs(staff!, "movement_create", { p: { kind: "paint", work_order_id: job.workOrderId, title: `E2E paint ${RUN}`, from: { kind: "warehouse" }, to: { kind: "site" } } });
    expect(made, "paint chip").toMatch(/^ok:/);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, job);
    if (settingsExisted) await db!.from("settings").update({ value: settingsBefore }).eq("key", "movements");
    else await db!.from("settings").delete().eq("key", "movements");
  });

  test("move rung → problem rung: the icon, the corner count and the hover list follow the ladder", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openMap(page);
    await expect(jobPin(page)).toHaveAttribute("data-tier", "move", { timeout: 15_000 });
    await expect(jobPin(page)).toHaveAttribute("data-fill", "amber");
    await expect(jobPin(page).getByTestId("map-count")).toHaveCount(0);

    // A materials pickup placed on the painter YESTERDAY and never ticked: the console says overdue.
    const made = await rpcAs(staff!, "movement_create", { p: { kind: "materials", work_order_id: job!.workOrderId, title: `E2E sundries ${RUN}`, from: { kind: "warehouse" }, to: { kind: "site" } } });
    expect(made).toMatch(/^ok:/);
    const id = made.replace(/^ok:/, "");
    expect(await rpcAs(staff!, "movement_place", { p_id: id, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: addDays(TODAY, -1), p_half: "AM", p_time: "07:30" })).toMatch(/^ok:/);
    await openMap(page);
    await expect(jobPin(page)).toHaveAttribute("data-tier", "problem", { timeout: 15_000 });
    await expect(jobPin(page)).toHaveAttribute("data-fill", "red");
    // The placed chip is itself still a need (not ordered) and the console may raise its own
    // movement items beside the overdue one, so the count is at least two — the exact number
    // is the console's business, the ORDER is the ladder's.
    const count = Number(await jobPin(page).getByTestId("map-count").textContent());
    expect(count).toBeGreaterThanOrEqual(2);
    await jobPin(page).getByRole("button").hover();
    const todo = jobPin(page).getByTestId("map-todo").locator("li");
    await expect(todo).toHaveCount(count);
    await expect(todo.first()).toHaveAttribute("data-tier", "problem");
    await expect(todo.filter({ hasText: "paint to plan" })).toHaveAttribute("data-tier", "move");
    const tiers = await todo.evaluateAll((els) => els.map((e) => e.getAttribute("data-tier")));
    expect(tiers.indexOf("move")).toBeGreaterThan(tiers.lastIndexOf("problem"));
    await page.mouse.move(5, 5);

    const legend = page.getByTestId("map-legend");
    for (const words of ["Something is wrong", "Call the client", "Office on site", "Something to move", "Closed job", "Nothing outstanding"]) await expect(legend).toContainText(words);
  });
});
