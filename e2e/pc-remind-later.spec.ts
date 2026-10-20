import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { melbourneDate, pcCardSnoozeKey } from "@/lib/workorder/console";

/**
 * Tom, 19 Oct 2026: "add a reminder date, to be able to close off an alert
 * and for it to pop back up at a later date."
 *
 * Every card on PC Command has Remind me…: pick a day, the card goes, and it
 * is back that morning if what raised it still stands. Two kinds of card, one
 * mechanism (a dated row in work_item_dismissals):
 *   · a work item (the quality-check strip) on its own key;
 *   · a console card (Quality check to do) on its pcCardSnoozeKey.
 * The pop-back is proved by moving the row's `until` into the past.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let strip: LoopFixture | null = null;
let parked: LoopFixture | null = null;
const keys: string[] = [];

const two = (n: number) => String(n).padStart(2, "0");
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
};
const today = melbourneDate(new Date());
const tomorrow = addDays(today, 1);

test.describe("Remind me… on a PC Command card", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture jobs");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    strip = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    parked = await createLoopFixture(db!, contractorId!, [{ heading: "Back", labels: ["Walls"] }]);
    const a = await db!.from("work_orders").update({ start_date: addDays(today, -1), end_date: addDays(today, 6) }).eq("id", strip.workOrderId);
    if (a.error) throw a.error;
    const b = await db!.from("work_orders").update({ stage: "qa" }).eq("id", parked.workOrderId);
    if (b.error) throw b.error;
    const c = await db!.from("wo_qa_checks").insert([
      { work_order_id: strip.workOrderId, kind: "final", trigger: "required" },
      { work_order_id: parked.workOrderId, kind: "final", trigger: "required" },
    ]);
    if (c.error) throw c.error;
  });

  test.afterAll(async () => {
    if (keys.length) await db!.from("work_item_dismissals").delete().in("item_key", keys);
    await destroyLoopFixture(db!, strip);
    await destroyLoopFixture(db!, parked);
  });

  const putAway = async (page: Parameters<Parameters<typeof test>[2]>[0]["page"], itemKey: string) => {
    await page.getByTestId(`remind-${itemKey}`).click();
    await page.getByTestId(`remind-date-${itemKey}`).fill(tomorrow);
    await page.getByTestId(`remind-set-${itemKey}`).click();
    await expect(page.getByTestId(`reminded-${itemKey}`)).toContainText(tomorrow, { timeout: 20_000 });
    keys.push(itemKey);
    const { data, error } = await db!.from("work_item_dismissals").select("until, reason").eq("item_key", itemKey).order("created_at", { ascending: false }).limit(1).single();
    if (error) throw error;
    const row = data as { until: string | null; reason: string };
    expect(row.reason).toContain(`Remind me on ${tomorrow}`);
    expect(row.until).not.toBeNull();
    return row;
  };
  const backInThePast = async (itemKey: string) => {
    const { error } = await db!.from("work_item_dismissals").update({ until: new Date(Date.now() - 60_000).toISOString() }).eq("item_key", itemKey);
    if (error) throw error;
  };

  test("a work item: the quality-check strip line goes until its day, then comes back", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const line = page.getByTestId(`qa-to-book-${strip!.workOrderId}`);
    await expect(line).toBeVisible({ timeout: 20_000 });
    const itemKey = (await line.getByTestId(/^remind-qa_check_to_book:/).getAttribute("data-testid"))!.slice("remind-".length);
    await putAway(page, itemKey);
    await page.goto("/pc");
    await expect(page.locator("h1")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`qa-to-book-${strip!.workOrderId}`)).toHaveCount(0);

    await backInThePast(itemKey);
    await page.goto("/pc");
    await expect(page.getByTestId(`qa-to-book-${strip!.workOrderId}`)).toBeVisible({ timeout: 20_000 });
  });

  test("a console card: Quality check to do goes until its day, then comes back", async ({ page }) => {
    const itemKey = pcCardSnoozeKey(parked!.workOrderId, `qa-due:${parked!.workOrderId}`);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    await expect(page.getByTestId(`action-qa-due:${parked!.workOrderId}`)).toBeVisible({ timeout: 20_000 });
    await putAway(page, itemKey);
    await page.goto("/pc");
    await expect(page.locator("h1")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`action-qa-due:${parked!.workOrderId}`)).toHaveCount(0);

    await backInThePast(itemKey);
    await page.goto("/pc");
    await expect(page.getByTestId(`action-qa-due:${parked!.workOrderId}`)).toBeVisible({ timeout: 20_000 });
  });
});
