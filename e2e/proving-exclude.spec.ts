import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 9 Sep 2026: "add a delete button so I can delete all of the proving
 * items which aren't relevant."
 *
 * It is not a delete: the row leaves the page and every number on it, the
 * estimate keeps its snapshot and its history, and it can be put back. This
 * drives that on the real screen with three estimates of its own.
 */
const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };

test.describe("Proving window · setting rows aside", () => {
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  const run = randomBytes(4).toString("hex");
  const ids: string[] = [];
  /**
   * "Remove all" is page-wide by design, so this spec sets aside every row
   * that happened to be on the window — on a shared test project that is 190+
   * estimates belonging to other runs. Remember which they were and put them
   * back, or each run leaves the next one an empty Proving page. Anything a
   * person had already set aside stays that way.
   */
  const keepAside = new Set<string>();

  test.beforeAll(async () => {
    // Three wizard estimates with frozen snapshots — one spot on, one wildly
    // corrected (the PaintScout comparison), one close.
    for (const [n, current] of [[1, 500_000], [2, 900_000], [3, 520_000]] as const) {
      const { data, error } = await db!.from("estimates").insert({
        title: `Proving ${run} #${n}`,
        status: "draft",
        source: "wizard",
        builder_state: {
          blocks: [{
            id: 1, kind: "line", name: "Job", type: "Interior", mode: "custom",
            hours: 0, rate: 0, qty: 0, unitPrice: 0, custom: current / 100, cost: 0, woHours: 0,
            description: "", clientNote: "", crewNote: "", hidden: false, isOption: false,
            subcontractorExpense: false, media: [], open: false, detailsOpen: false,
          }],
          wizard: {
            submittedAt: "2026-09-01T00:00:00.000Z",
            snapshot: { totalCents: 500_000, accuracyPct: 70, outcome: "reveal", walkthroughRequired: false },
          },
        },
      }).select("id").single();
      expect(error, error?.message).toBeNull();
      ids.push((data as { id: string }).id);
    }

    // Rows that were ALREADY set aside before this run — staff's own choices,
    // which afterAll must leave alone. Filtered server-side on the record's
    // own `at`: the test project holds ~65k estimates, so any unordered
    // .limit() window is a coin toss (it hid all 192 rows the first cleanup
    // went looking for), and a JSON null is not a SQL NULL.
    const { data: already } = await db!
      .from("estimates").select("id")
      .not("builder_state->wizard->provingExcluded->>at", "is", null);
    for (const r of already ?? []) keepAside.add((r as { id: string }).id);
  });

  test.afterAll(async () => {
    if (!db) return;
    if (ids.length) await db.from("estimates").delete().in("id", ids);
    // Put back everything this run set aside — never what staff had.
    for (let pass = 0; pass < 20; pass++) {
      const { data } = await db.from("estimates").select("id, builder_state")
        .not("builder_state->wizard->provingExcluded->>at", "is", null).limit(100);
      const todo = (data ?? []).filter((r) => !keepAside.has((r as { id: string }).id));
      if (todo.length === 0) break;
      for (const r of todo) {
        const state = ((r as { builder_state?: Record<string, unknown> }).builder_state ?? {}) as Record<string, unknown>;
        const wizard = ((state.wizard as Record<string, unknown> | undefined) ?? {});
        await db.from("estimates")
          .update({ builder_state: { ...state, wizard: { ...wizard, provingExcluded: null } } })
          .eq("id", (r as { id: string }).id);
      }
    }
  });

  test("one row off, then back; the estimate's snapshot survives both", async ({ page }) => {
    test.setTimeout(420_000);
    await page.goto("/login");
    await page.fill('input[type="email"]', staff.email);
    await page.fill('input[type="password"]', staff.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/estimates/);

    await page.goto("/proving");
    // The staff shell carries hidden tables of its own — address ours.
    const table = page.getByTestId("proving-table");
    await expect(table).toContainText(`Proving ${run} #2`, { timeout: 120_000 });

    // Take the outlier off from its own row.
    const outlier = table.locator("tr", { hasText: `Proving ${run} #2` });
    await outlier.getByTestId("exclude-one").click();
    await expect(page.getByTestId("proving-excluded")).toContainText(`Proving ${run} #2`, { timeout: 120_000 });
    await expect(table).not.toContainText(`Proving ${run} #2`);
    // …and the other two are still measured.
    await expect(table).toContainText(`Proving ${run} #1`);

    // The estimate itself is untouched: snapshot intact, status intact.
    const { data } = await db!.from("estimates").select("status, builder_state").eq("id", ids[1]).single();
    const wiz = ((data as { builder_state: { wizard?: Record<string, unknown> } }).builder_state.wizard ?? {}) as Record<string, unknown>;
    expect((wiz.snapshot as { totalCents: number }).totalCents).toBe(500_000);
    expect((data as { status: string }).status).toBe("draft");
    expect(wiz.provingExcluded).not.toBeNull();

    // Put it back — and the key goes, rather than being left as a JSON null.
    const setAside = page.getByTestId("proving-excluded").locator("li", { hasText: `Proving ${run} #2` });
    await setAside.getByTestId("restore-one").click();
    await expect(page.getByTestId("proving-table")).toContainText(`Proving ${run} #2`, { timeout: 120_000 });
    const { data: back } = await db!.from("estimates").select("builder_state").eq("id", ids[1]).single();
    const backWiz = ((back as { builder_state: { wizard?: Record<string, unknown> } }).builder_state.wizard ?? {}) as Record<string, unknown>;
    expect("provingExcluded" in backWiz).toBe(false);
  });

  test("remove-all asks why, clears the table, and the reason is kept", async ({ page }) => {
    test.setTimeout(420_000);
    await page.goto("/login");
    await page.fill('input[type="email"]', staff.email);
    await page.fill('input[type="password"]', staff.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/estimates/);
    await page.goto("/proving");
    await expect(page.getByTestId("proving-table")).toContainText(`Proving ${run} #1`, { timeout: 120_000 });

    await page.getByTestId("exclude-all").click();
    await page.getByTestId("exclude-reason").fill("compared against PaintScout, not a fair test");
    await page.getByTestId("exclude-confirm").click();

    const aside = page.getByTestId("proving-excluded");
    await expect(aside).toContainText("compared against PaintScout", { timeout: 180_000 });
    await expect(aside).toContainText(`Proving ${run} #1`);
    await expect(page.getByTestId("proving-table")).not.toContainText(`Proving ${run} #1`);

    // Every one of ours is off, and the page says so rather than showing stale numbers.
    const { data } = await db!.from("estimates").select("id, builder_state").in("id", ids);
    for (const r of data ?? []) {
      const wiz = ((r as { builder_state: { wizard?: Record<string, unknown> } }).builder_state.wizard ?? {}) as Record<string, unknown>;
      expect(wiz.provingExcluded, `${(r as { id: string }).id} excluded`).toBeTruthy();
    }
  });
});
