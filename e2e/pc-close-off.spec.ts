import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { melbourneDate } from "@/lib/workorder/console";

/**
 * Tom, 11 Nov 2026: "update the dashboard in PC Command so all reminders can
 * be closed off".
 *
 * Every card on PC Command now goes for good from the card itself. The ones
 * with no outcome button of their own (Rang them, Reviewed, Confirmed, ✕) got
 * "Close off" — the queue's own crm_dismiss_work_item with no end date, the
 * same dismissal Today uses. Proved on the quality-check strip (a required
 * check with no day yet), which had only Remind me… before: it goes, stays
 * gone across a reload, and the dismissal log says why.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;
const keys: string[] = [];

const two = (n: number) => String(n).padStart(2, "0");
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
};
const today = melbourneDate(new Date());

test.describe("Close off on a PC Command reminder", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    const a = await db!.from("work_orders").update({ start_date: addDays(today, -1), end_date: addDays(today, 6) }).eq("id", job.workOrderId);
    if (a.error) throw a.error;
    const c = await db!.from("wo_qa_checks").insert({ work_order_id: job.workOrderId, kind: "final", trigger: "required" });
    if (c.error) throw c.error;
  });

  test.afterAll(async () => {
    if (keys.length) await db!.from("work_item_dismissals").delete().in("item_key", keys);
    await destroyLoopFixture(db!, job);
  });

  test("a reminder with no outcome button closes off for good", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const line = page.getByTestId(`qa-to-book-${job!.workOrderId}`);
    await expect(line).toBeVisible({ timeout: 20_000 });
    await expect(line).toHaveAttribute("data-state", "undated");
    const itemKey = (await line.getByTestId(/^remind-qa_check_to_book:/).getAttribute("data-testid"))!.slice("remind-".length);
    keys.push(itemKey);

    // Both ways out sit side by side: for good, or back on a day.
    await expect(line.getByTestId(`remind-${itemKey}`)).toBeVisible();
    const close = line.getByTestId(`dismiss-${itemKey}`);
    await expect(close).toHaveText("Close off");
    await close.click();
    await expect(page.getByTestId(`dismissed-${itemKey}`)).toBeVisible({ timeout: 20_000 });

    const { data, error } = await db!.from("work_item_dismissals").select("until, reason").eq("item_key", itemKey).order("created_at", { ascending: false }).limit(1).single();
    if (error) throw error;
    const row = data as { until: string | null; reason: string };
    expect(row.until).toBeNull();
    expect(row.reason).toBe("Closed off from PC Command");

    await page.goto("/pc");
    await expect(page.locator("h1")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`qa-to-book-${job!.workOrderId}`)).toHaveCount(0);
  });
});
