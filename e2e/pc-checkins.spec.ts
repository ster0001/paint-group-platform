import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 6 Oct 2026: "move all job check-ins out of the CRM system and into PC
 * Command." The check-in is still the one queue's item (same key, same
 * dismissal); it is SHOWN on /pc and left off /crm/today.
 *
 * The fixture is a two-day job whose last booked day has passed, so the
 * after-job call ("job done, check they are happy") is due. The two days are
 * the most recent pair of weekdays, so the planner counts them whatever
 * today is.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;
let woRef = "";

const melbDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const weekday = (d: Date) => { const n = new Date(`${melbDay(d)}T12:00:00+10:00`).getUTCDay(); return n >= 1 && n <= 5; };
/** The last two consecutive weekdays that ended at least two days ago. */
function recentWeekdayPair(): [string, string] {
  let end = new Date(Date.now() - 2 * 86_400_000);
  while (!weekday(end)) end = new Date(end.getTime() - 86_400_000);
  let start = new Date(end.getTime() - 86_400_000);
  while (!weekday(start)) start = new Date(start.getTime() - 86_400_000);
  return [melbDay(start), melbDay(end)];
}

test.describe.configure({ mode: "serial" });

test.describe("check-ins live on PC Command", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    const [start, end] = recentWeekdayPair();
    await db!.from("work_orders").update({ stage: "in_progress", start_date: start, end_date: end }).eq("id", job.workOrderId);
    await db!.from("estimates").update({ accepted_name: "Priya Checkin" }).eq("id", job.estimateId);
    const { data } = await db!.from("work_orders").select("wo_ref").eq("id", job.workOrderId).single();
    woRef = (data as { wo_ref: string }).wo_ref;
  });

  test.afterAll(async () => {
    // The dismissal this run writes hangs off the job's key, not a FK — remove it with the job.
    if (job) await db!.from("work_item_dismissals").delete().like("item_key", `%:work_order:${job.workOrderId}:%`);
    await destroyLoopFixture(db!, job);
  });

  test("the after-job call is a card on PC Command, and not on Today", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.locator(`[data-testid^="checkin-job_followup:work_order:${job!.workOrderId}:"]`).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Priya Checkin — job done, check they are happy");
    await expect(card).toContainText(woRef);
    await expect(card.getByRole("link", { name: "Open the job" })).toHaveAttribute("href", `/pc/wo/${job!.workOrderId}`);

    await page.goto("/crm/today");
    await expect(page.getByText("Priya Checkin — job done, check they are happy")).toHaveCount(0);
  });

  test("Rang them clears it through the one queue's dismissal", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.locator(`[data-testid^="checkin-job_followup:work_order:${job!.workOrderId}:"]`).first();
    await card.getByRole("button", { name: "Rang them" }).click();
    await expect(card.getByText("Noted")).toBeVisible();

    const { data } = await db!.from("work_item_dismissals").select("item_key, reason, until")
      .like("item_key", `job_followup:work_order:${job!.workOrderId}:%`);
    const rows = (data ?? []) as { reason: string; until: string | null }[];
    expect(rows.length).toBe(1);
    expect(rows[0].until).toBeNull();
    expect(rows[0].reason).toContain("Rang them");

    await page.goto("/pc");
    await expect(page.locator(`[data-testid^="checkin-job_followup:work_order:${job!.workOrderId}:"]`)).toHaveCount(0);
  });
});
