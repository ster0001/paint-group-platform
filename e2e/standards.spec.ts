import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  accessTokenFor, contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Finish standards, Step 1 (brief: standards / painter status / call backs).
 *
 * AS THE PAINTER, on a phone, in both themes: the standards under Help (the
 * surface grid, a surface at each level, the rule pages); "What we expect" on
 * a work-order surface line, opening THAT surface locked to the job's level
 * with "See other levels"; a line with no mapped standard showing no link;
 * "Tape check required / not required" from the job's hours; and the three
 * extra-time chips on a variation. AS THE PC: the quality-check screen links
 * each surface to the same record. AND through each role's own token: a
 * painter reads the 17 surfaces, a customer reads none (RLS, not inspection).
 *
 * The fixture job carries one area with no side (labels only — an issued job
 * from before the snapshot carried codes) and one exterior area whose window
 * line carries its rate code, so both ways a line finds its standard run.
 */

const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let job: LoopFixture | null = null;

async function readAs(token: string | null, path: string): Promise<{ rows: unknown[] | null; status: number }> {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const body = await res.json().catch(() => null);
  return { rows: Array.isArray(body) ? body : null, status: res.status };
}

async function setTheme(page: Page, want: "light" | "dark") {
  const pt = page.locator(".pt");
  const current = await pt.getAttribute("data-theme");
  if (current !== want) await page.getByTestId("theme-toggle").click();
  await expect(pt).toHaveAttribute("data-theme", want);
}

test.describe.configure({ mode: "serial" });

test.describe("finish standards — the painter, the PC and the roles", () => {
  test.skip(!contractor || !staff || !customer, missingCreds("CUSTOMER"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");
  // A painter reads these on site.
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [
      { heading: "Lounge", labels: ["Walls", "Gutters"] },
      { heading: "Outside", labels: ["Double Hung Sash"] },
    ]);
    // The exterior area says which side it is and its window carries the rate
    // code, as a snapshot frozen after 8 Oct 2026 does; the Lounge has neither.
    const { data: wo } = await db!.from("work_orders").select("wo_snapshot").eq("id", job.workOrderId).single();
    const snap = (wo as { wo_snapshot: { areas: { title: string; side?: string; surfaces: { label: string; code?: string; hours: number | null }[] }[] } }).wo_snapshot;
    const outside = snap.areas.find((a) => a.title === "Outside")!;
    outside.side = "exterior";
    outside.surfaces[0].code = "Double Hung Sash";
    const up = await db!.from("work_orders").update({ wo_snapshot: snap }).eq("id", job.workOrderId);
    expect(up.error?.message ?? "").toBe("");
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("RLS, through each role's own token: a painter reads 17 surfaces, a customer none, nobody anonymous", async () => {
    const painter = await readAs(await accessTokenFor(contractor!), "standards_surfaces?select=key,side&order=side,sort");
    expect(painter.rows).toHaveLength(17);
    const office = await readAs(await accessTokenFor(staff!), "standards_checks?select=id");
    expect(office.rows).toHaveLength(159);
    const cust = await readAs(await accessTokenFor(customer!), "standards_surfaces?select=key");
    expect(cust.rows).toEqual([]);
    const custChecks = await readAs(await accessTokenFor(customer!), "standards_checks?select=id");
    expect(custChecks.rows).toEqual([]);
    const anon = await readAs(null, "standards_surfaces?select=key");
    expect(anon.rows).toBeNull();
    // Nobody but the loader writes.
    const write = await fetch(`${URL}/rest/v1/standards_surface_codes`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${await accessTokenFor(staff!)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ surface_id: "00000000-0000-0000-0000-000000000000", substrate_code: "x" }),
    });
    expect([401, 403]).toContain(write.status);
  });

  test("Help carries the standards: the grid, a surface at every level, the rule pages", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/help");
    await page.getByTestId("help-standards-pinned").click();
    await expect(page).toHaveURL(/\/portal\/help\/standards$/);
    await expect(page.getByTestId("standards-index")).toBeVisible();
    await expect(page.getByTestId("standards-grid").locator("a")).toHaveCount(7);
    await page.getByTestId("standards-side-exterior").click();
    await expect(page.getByTestId("standards-grid").locator("a")).toHaveCount(10);
    await expect(page.getByTestId("standards-surface-fretwork")).toBeVisible();

    await page.getByTestId("standards-side-interior").click();
    await page.getByTestId("standards-surface-walls").click();
    const surface = page.getByTestId("standards-surface");
    await expect(surface).toHaveAttribute("data-level", "3");
    await expect(surface).toHaveAttribute("data-locked", "false");
    await expect(page.getByTestId("standards-every-level")).toContainText("No paint on switches or power points.");
    await expect(page.getByTestId("standards-checks")).toContainText("Sharp and straight from 1.5 m.");
    await page.getByTestId("standards-level-4").click();
    await expect(surface).toHaveAttribute("data-level", "4");
    await expect(page.getByTestId("standards-checks")).toContainText("Sharp and straight from 0.5 m.");
    await page.getByTestId("standards-level-2").click();
    await expect(page.getByTestId("standards-checks")).toContainText("Straight and tidy from 3 m.");

    await page.getByTestId("standards-back").click();
    await page.getByTestId("standards-section-defect").click();
    await expect(page.getByTestId("standards-section")).toHaveAttribute("data-section", "defect");
    await expect(page.getByTestId("standards-small-job-note")).toContainText("On jobs under 16 hours, the tape step is not required.");
  });

  test("the standards read in both themes, in the portal's own tokens", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/help/standards/walls");
    await setTheme(page, "dark");
    const tile = page.getByTestId("standards-every-level");
    expect(await tile.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(237, 240, 242)");
    await setTheme(page, "light");
    expect(await tile.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(18, 22, 26)");
    expect(await page.locator(".std-card.every").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    await setTheme(page, "dark");
  });

  test("a work-order line opens its surface locked to the job's level; an unmapped line has no link; the tape check reads from the hours", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    await expect(page.getByTestId("tick-list")).toBeVisible();

    // Tom, 9 Oct: ONE drop-down at the top, closed so the job doesn't scroll —
    // every mapped line inside it, each standard once: Walls by label, the
    // exterior window by its code and the area's side; Gutters maps to nothing.
    const card = page.getByTestId("what-we-expect");
    await expect(card).toHaveAttribute("data-count", "2");
    await expect(card).toHaveAttribute("data-sections", "2");
    await expect(card).not.toHaveAttribute("open", "");
    await expect(card.getByTestId("wwe-std-walls-3")).toBeHidden();
    // No link scattered under the rows or the sheet lines any more.
    await expect(page.locator(".tick-expect, .surf-expect")).toHaveCount(0);
    // Open the one drop-down: the whole document — no second tap per line.
    await card.getByTestId("what-we-expect-toggle").click();
    await expect(card.getByTestId("wwe-std-walls-3")).toContainText("Sharp and straight from 1.5 m.");
    await expect(card.getByTestId("wwe-line-a0:0")).toContainText("Lounge · Walls");
    await expect(card.getByTestId("wwe-line-a0:1")).toHaveCount(0);
    await expect(card.getByTestId("wwe-std-extwindows-3")).toBeVisible();
    await expect(card.getByTestId("wwe-std-extwindows-3").getByTestId("wwe-line-a1:0")).toBeVisible();
    const walls = card.getByTestId("wwe-open-walls-3");
    await expect(walls).toHaveAttribute("href", `/portal/help/standards/walls?level=3&job=${job!.workOrderId}`);
    await expect(page.getByTestId("standards-unavailable")).toHaveCount(0);

    // 3 estimated hours: under the 16-hour threshold.
    const tape = page.getByTestId("wo-tape-check");
    await expect(tape).toHaveAttribute("data-required", "false");
    await expect(tape).toContainText("Tape check not required");

    await walls.click();
    await expect(page).toHaveURL(/\/portal\/help\/standards\/walls\?level=3&job=/);
    await expect(page.getByTestId("standards-surface")).toHaveAttribute("data-locked", "true");
    await expect(page.getByTestId("standards-locked-level")).toHaveText("Level 3 on this job");
    await expect(page.getByTestId("standards-level-4")).toHaveCount(0);
    await expect(page.getByTestId("standards-back")).toContainText("Job");
    await page.getByTestId("standards-unlock").click();
    await expect(page.getByTestId("standards-surface")).toHaveAttribute("data-locked", "false");
    await expect(page.getByTestId("standards-level-4")).toBeVisible();

    // A bigger job: the sheet says the tape check is required.
    const { data: wo } = await db!.from("work_orders").select("wo_snapshot").eq("id", job!.workOrderId).single();
    const snap = (wo as { wo_snapshot: { areas: { surfaces: { hours: number | null }[] }[] } }).wo_snapshot;
    snap.areas[0].surfaces[0].hours = 20;
    await db!.from("work_orders").update({ wo_snapshot: snap }).eq("id", job!.workOrderId);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    await expect(page.getByTestId("wo-tape-check")).toHaveAttribute("data-required", "true");
    await expect(page.getByTestId("wo-tape-check")).toContainText("Tape check required");
  });

  test("the finish chip opens the approved level summary and links to the standards", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    await page.getByTestId("finish-chip").click();
    const sheet = page.getByTestId("finish-sheet");
    await expect(sheet).toContainText("Our standard finish");
    await expect(sheet).toContainText("Every mark you can see from 1.5 m.");
    await expect(sheet).not.toContainText("Showcase");
    await expect(page.getByTestId("finish-sheet-standards")).toHaveAttribute("href", "/portal/help/standards/s/levels");
  });

  test("raising a variation offers Bogging, Stain blocking and Additional coats", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    await page.getByRole("button", { name: /found something/i }).click();
    for (const code of ["bogging", "stain_blocking", "additional_coats", "rot", "extra_scope"]) {
      await expect(page.getByTestId(`category-${code}`)).toBeVisible();
    }
    await expect(page.getByTestId("category-bogging")).toHaveText("Bogging");
  });

  test("the PC's tick list and quality check link each surface to the same record, at the job's level", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    const card = page.getByTestId("what-we-expect");
    await expect(card).toHaveAttribute("data-count", "2");
    await expect(card.getByTestId("wwe-open-walls-3")).toHaveAttribute("href", `/pc/standards/walls?level=3&job=${job!.workOrderId}`);
    await expect(card.getByTestId("wwe-line-a0:1")).toHaveCount(0);
    await expect(page.locator(".tick-expect")).toHaveCount(0);

    // A quality check at the qa stage: the card carries the surfaces' standards.
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", job!.workOrderId);
    await db!.from("work_orders").update({ stage: "qa" }).eq("id", job!.workOrderId);
    const { data: check } = await db!.from("wo_qa_checks")
      .insert({ work_order_id: job!.workOrderId, kind: "final" }).select("id").single();
    const checkId = (check as { id: string }).id;
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    // Tom, 9 Oct: the same card at the top of the job serves the check — no second list on the check card.
    await expect(page.getByTestId(`qa-${checkId}`)).toBeVisible();
    await expect(page.locator(".qa-expect")).toHaveCount(0);
    const qaCard = page.getByTestId("what-we-expect");
    await expect(qaCard).toHaveAttribute("data-count", "2"); // Walls and the window; Gutters has none
    await qaCard.getByTestId("what-we-expect-toggle").click();
    await expect(qaCard.getByTestId("wwe-line-a0:0")).toContainText("Lounge · Walls");
    await qaCard.getByTestId("wwe-open-walls-3").click();
    await expect(page).toHaveURL(/\/pc\/standards\/walls\?level=3&job=/);
    await expect(page.getByTestId("standards-locked-level")).toHaveText("Level 3 on this job");
    await expect(page.getByTestId("standards-checks")).toContainText("Sharp and straight from 1.5 m.");
  });
});
