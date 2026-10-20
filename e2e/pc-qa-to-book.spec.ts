import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { melbourneDate } from "@/lib/workorder/console";

/**
 * Tom, 19 Oct 2026: "if a quality check is required, it needs to be visible
 * at the top of the page in PC command to book in the quality check before
 * the final walk through".
 *
 * A required main check is a strip at the top of PC Command from the booking
 * until its day (lib/crm/work-queue.ts qa_check_to_book — the one queue, drawn
 * in its own place), in one of three states:
 *   undated          → Book the check
 *   final not booked → Book it in (the check is pencilled on the last day)
 *   booked           → Open the check (and Confirmed, to put it away)
 * On the check's day it becomes the day's card; a job parked at Quality check
 * is the console's own card; a recorded check clears it.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let f: LoopFixture | null = null;
let checkId = "";

const two = (n: number) => String(n).padStart(2, "0");
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
};
const today = melbourneDate(new Date());

test.describe("a required quality check at the top of PC Command", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    f = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    const { error } = await db!.from("work_orders").update({ start_date: addDays(today, -1), end_date: addDays(today, 6) }).eq("id", f.workOrderId);
    if (error) throw error;
    // The office's flag makes the check required whatever the e2e painter's record says.
    const { data: c, error: cErr } = await db!.from("wo_qa_checks")
      .insert({ work_order_id: f.workOrderId, kind: "final", trigger: "required" }).select("id").single();
    if (cErr) throw cErr;
    checkId = (c as { id: string }).id;
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, f);
  });

  test("undated: the strip says book it, with the job's check card one tap away", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const strip = page.getByTestId("qa-to-book");
    await expect(strip).toBeVisible({ timeout: 20_000 });
    const item = page.getByTestId(`qa-to-book-${f!.workOrderId}`);
    await expect(item).toHaveAttribute("data-state", "undated");
    await expect(item).toContainText(/no day booked yet/i);
    await expect(page.getByTestId(`qa-to-book-open-${f!.workOrderId}`)).toHaveAttribute("href", `/pc/wo/${f!.workOrderId}#qa`);
    // Not also a card in Needs you now.
    await expect(page.getByTestId("queue").getByText(/no day booked yet/i)).toHaveCount(0);
  });

  test("dated with no final booked, then booked before a booked final; gone once parked at Quality check", async ({ page }) => {
    const day = addDays(today, 3);
    expect(await rpcAs(staff!, "wo_qa_set_schedule", { p_check_id: checkId, p_date: day, p_time: "09:00" })).toMatch(/^ok:/);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    let item = page.getByTestId(`qa-to-book-${f!.workOrderId}`);
    await expect(item).toBeVisible({ timeout: 20_000 });
    await expect(item).toHaveAttribute("data-state", "final-unbooked");
    await expect(item).toContainText(/final walkthrough not booked/i);

    // The final is booked (the booking sheet does this at offer time; the RPC
    // refuses it mid-job while a check is open) → the check follows it
    // (20270247) and the strip says so.
    const { error: bErr } = await db!.from("wo_walkthroughs").insert({
      work_order_id: f!.workOrderId, kind: "final", status: "booked", scheduled_date: addDays(today, 6), scheduled_time: "15:00",
    });
    if (bErr) throw bErr;
    await page.goto("/pc");
    item = page.getByTestId(`qa-to-book-${f!.workOrderId}`);
    await expect(item).toBeVisible({ timeout: 20_000 });
    await expect(item).toHaveAttribute("data-state", "booked");
    await expect(item).toContainText(/before the final walkthrough on/i);

    const { error } = await db!.from("work_orders").update({ stage: "qa" }).eq("id", f!.workOrderId);
    if (error) throw error;
    await page.goto("/pc");
    await expect(page.locator("h1")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`qa-to-book-${f!.workOrderId}`)).toHaveCount(0);
  });
});
