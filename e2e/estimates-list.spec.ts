import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn, test } from "./helpers";

/**
 * Estimates tab & funnel, session 3 — the REGRESSION GUARD (brief §4.1, R2/R14,
 * ruling E‑Q). Written against the list as it stood before the session-3
 * shell, and kept green after it: the same search, the same nine tabs, the
 * same fixed newest-first order, the same row link into the estimate.
 *
 * Five estimates are planted under one run tag so the search narrows the list
 * to them alone, whatever else the test project holds.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const TAG = `listguard${run}`;
const minute = 60_000;

type Planted = { key: string; status: string; viewed: boolean; ageMin: number; id?: string };
const PLANTED: Planted[] = [
  { key: "draft", status: "draft", viewed: false, ageMin: 50 },
  { key: "sent", status: "sent", viewed: false, ageMin: 40 },
  { key: "viewed", status: "sent", viewed: true, ageMin: 30 },
  { key: "accepted", status: "accepted", viewed: true, ageMin: 20 },
  { key: "declined", status: "declined", viewed: true, ageMin: 10 },
];
/** Which planted rows each tab shows (`filterQuery`: Sent and Viewed split one status by viewed_at). */
const TAB_SHOWS: Record<string, string[]> = {
  all: ["declined", "accepted", "viewed", "sent", "draft"],
  draft: ["draft"],
  sent: ["sent"],
  viewed: ["viewed"],
  accepted: ["accepted"],
  declined: ["declined"],
  expired: [],
};

const rowIds = (page: Page) => page.locator('[data-testid^="status-"]').evaluateAll(
  (els) => els.map((el) => (el.getAttribute("data-testid") ?? "").slice("status-".length)),
);

test.describe("Estimates list — regression guard (R2/R14)", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));

  test.beforeAll(async () => {
    const now = Date.now();
    for (const p of PLANTED) {
      const at = new Date(now - p.ageMin * minute).toISOString();
      const { data, error } = await db!.from("estimates").insert({
        title: `List guard ${p.key} ${TAG}`, status: p.status, source: "manual", level_of_finish: 3, created_at: at,
        sent_at: p.status === "draft" ? null : at, viewed_at: p.viewed ? at : null,
        accepted_at: p.status === "accepted" ? at : null, declined_at: p.status === "declined" ? at : null,
        builder_state: { blocks: [], contact: { first_name: "Guard", last_name: `${p.key}${run}` } },
      }).select("id").single();
      if (error) throw new Error(error.message);
      p.id = data.id as string;
    }
  });
  test.afterAll(async () => {
    if (!db) return;
    const ids = PLANTED.map((p) => p.id).filter((x): x is string => Boolean(x));
    if (ids.length) await db.from("estimates").delete().in("id", ids);
  });

  test("the list opens on All, newest first, and the search narrows it to the planted rows", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    await page.goto("/estimates");
    await expect(page.getByTestId("estimates-tab-all")).toHaveClass(/border-gray-900/);
    await expect(page.getByTestId("estimates-search")).toHaveAttribute("data-ready", "1");
    await page.getByTestId("estimates-search-input").fill(TAG);
    await expect(page).toHaveURL(new RegExp(`[?&]q=${TAG}`));
    const byKey = Object.fromEntries(PLANTED.map((p) => [p.key, p.id!]));
    await expect.poll(() => rowIds(page), { timeout: 30_000 }).toEqual(TAB_SHOWS.all.map((k) => byKey[k]));
  });

  test("each status tab, searched, shows exactly its rows", async ({ page }) => {
    test.setTimeout(180_000); // nine page loads on a dev server
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    const byKey = Object.fromEntries(PLANTED.map((p) => [p.key, p.id!]));
    for (const [tab, keys] of Object.entries(TAB_SHOWS)) {
      await page.goto(`/estimates?status=${tab}&q=${TAG}`);
      await expect(page.getByTestId(`estimates-tab-${tab}`)).toHaveClass(/border-gray-900/);
      if (keys.length === 0) {
        await expect(page.getByTestId("estimates-search-empty")).toBeVisible();
        continue;
      }
      await expect.poll(() => rowIds(page), { timeout: 30_000, message: `tab ${tab}` }).toEqual(keys.map((k) => byKey[k]));
    }
    // The Waiting and Wizard tabs still open (they read the queue and the sessions, not these rows).
    for (const tab of ["waiting", "wizard"]) {
      await page.goto(`/estimates?status=${tab}`);
      await expect(page.getByTestId(`estimates-tab-${tab}`)).toHaveClass(/border-gray-900/);
    }
  });

  test("a row opens its estimate", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    const id = PLANTED.find((p) => p.key === "viewed")!.id!;
    await page.goto(`/estimates?status=viewed&q=${TAG}`);
    await page.locator(`a[href="/quote?id=${id}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/quote\\?id=${id}`));
  });
});
