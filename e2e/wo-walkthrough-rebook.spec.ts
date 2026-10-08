import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom (8 Oct 2026): "When a walk through is cancelled, I am unable to rebook
 * another one — please see 12 Cavell Court."
 *
 * Cavell (PS-3156): the final walkthrough was confirmed with the client on the
 * booking sheet (26 Sep), the quality check was scheduled when the painter
 * accepted (27 Sep), the office cancelled the walkthrough on 6 Oct — and every
 * "Book final" since answered "Quality check first". wo_book_walkthrough
 * refused ANY final while a check was unpassed (the 23 Aug ruling), so a date
 * the booking sheet could set before the check existed could never be set
 * again once it did. Cancelling was a one-way door.
 *
 * Now (20270241) a final that was already agreed with the client — booked
 * before, in any status — can always be rebooked. A job that never had a final
 * date still waits for the checks (wo-qa-ruling / wo-qa-recheck keep that).
 *
 * Staff-only screen: the customer has no control over walkthrough bookings,
 * so there is no anonymous-customer half to this story.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;
let firstId = "";

/** A date n days out, Melbourne calendar day. */
function inDays(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
}

type WtRow = { id: string; status: string; scheduled_date: string; scheduled_time: string | null };
async function walkthroughs(): Promise<WtRow[]> {
  const { data, error } = await db!.from("wo_walkthroughs")
    .select("id, status, scheduled_date, scheduled_time")
    .eq("work_order_id", job!.workOrderId).eq("kind", "final").order("created_at");
  if (error) throw new Error(`walkthroughs read: ${error.message}`);
  return (data ?? []) as WtRow[];
}

test.describe.configure({ mode: "serial" });

test.describe("a cancelled final walkthrough can be rebooked (12 Cavell Court)", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: "Front Side", labels: ["Rendered Walls"] }]);

    // Cavell's order: the booking sheet books the final with the client FIRST…
    const booked = await rpcAs(staff!, "wo_book_walkthrough", {
      p_work_order_id: job.workOrderId, p_kind: "final", p_date: inDays(5),
      p_note: "Confirmed with the client at booking", p_time: "15:30",
    });
    expect(booked).toMatch(/^ok:/);
    firstId = booked.slice(3);

    // …then the quality check is scheduled, and stays open while the job runs.
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: job.workOrderId, p_required: true }))
      .toMatch(/^ok/);
    expect(Number(await rpcAs(staff!, "wo_qa_open_count", { p_work_order_id: job.workOrderId }))).toBeGreaterThan(0);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("the office cancels it on the job page, then books a new date — and it sticks", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    const card = page.getByTestId("walkthrough-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    await card.getByTestId(`walkthrough-cancel-${firstId}`).click();
    await expect.poll(async () => (await walkthroughs()).find((w) => w.id === firstId)?.status, {
      timeout: 20_000, message: "the cancel did not land",
    }).toBe("cancelled");
    await expect(card.locator("h3")).toContainText(/not booked/i, { timeout: 15_000 });

    const newDate = inDays(7);
    await card.getByTestId("walkthrough-date").fill(newDate);
    await card.getByTestId("walkthrough-time").fill("10:00");
    await card.getByTestId("book-final").click();

    await expect(card.getByTestId("walkthrough-msg")).toHaveText(/final walkthrough booked/i, { timeout: 20_000 });
    const rows = await walkthroughs();
    const live = rows.filter((w) => w.status === "booked");
    expect(live.length, "exactly one booked final").toBe(1);
    expect(live[0].scheduled_date).toBe(newDate);
    expect(live[0].scheduled_time).toBe("10:00:00");
    expect(rows.find((w) => w.id === firstId)?.status).toBe("cancelled");
  });

  test("a booked final can be moved again while the check is still open", async () => {
    const moved = await rpcAs(staff!, "wo_book_walkthrough", {
      p_work_order_id: job!.workOrderId, p_kind: "final", p_date: inDays(9), p_note: "", p_time: null,
    });
    expect(moved).toMatch(/^ok:/);
    const live = (await walkthroughs()).filter((w) => w.status === "booked");
    expect(live.map((w) => w.scheduled_date)).toEqual([inDays(9)]);
  });

  test("a job that never had a final date still waits for the quality check", async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    const fresh = await createLoopFixture(db!, contractorId!, [{ heading: "Back", labels: ["Walls"] }]);
    try {
      expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: fresh.workOrderId, p_required: true }))
        .toMatch(/^ok/);
      expect(await rpcAs(staff!, "wo_book_walkthrough", {
        p_work_order_id: fresh.workOrderId, p_kind: "final", p_date: inDays(5), p_note: "", p_time: null,
      })).toBe("error:qa_first");
    } finally {
      await destroyLoopFixture(db!, fresh);
    }
  });
});
