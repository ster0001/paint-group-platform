import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * The calendar and the work order have to agree from the moment a job is
 * OFFERED — not from the moment it is accepted. Before this, a job the office
 * had scheduled showed no dates at all on its own work order.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;
let offerId = "";
// Far enough out that the fixture cannot land on a real booking. The first
// version used +3 days, collided with a demo job, and "opened the wrong job" —
// which is really a calendar limitation: days are keyed by date, so when two
// jobs share a day the last one silently wins.
const start = new Date(Date.now() + 47 * 86_400_000).toISOString().slice(0, 10);
const end = new Date(Date.now() + 49 * 86_400_000).toISOString().slice(0, 10);

const dates = async () => {
  const { data } = await db!.from("work_orders")
    .select("start_date, end_date").eq("id", job!.workOrderId).single();
  return data as { start_date: string | null; end_date: string | null };
};

const bookingState = async () => {
  const { data } = await db!.rpc("wo_booking", { p_work_order_id: job!.workOrderId });
  return ((data as { state: string }[] | null) ?? [])[0]?.state ?? "none";
};

test.describe.configure({ mode: "serial" });

test.describe("the booking reaches the work order when it is requested", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("work_orders").update({
      stage: "offered", status: "issued", contractor_id: null, start_date: null, end_date: null,
    }).eq("id", job.workOrderId);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("an unbooked job has no dates and says so", async () => {
    expect(await dates()).toEqual({ start_date: null, end_date: null });
    expect(await bookingState()).toBe("none");
  });

  test("offering it puts the dates on the work order straight away", async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    const sent = await rpcAs(staff!, "send_offer", {
      p_work_order_id: job!.workOrderId, p_contractor_id: contractorId,
      p_start: start, p_end: end, p_note: "",
    });
    expect(sent).toMatch(/^ok|offered/);

    // The point of the whole batch: before anyone has accepted anything.
    expect(await dates()).toEqual({ start_date: start, end_date: end });
    expect(await bookingState()).toBe("requested");

    const { data } = await db!.from("booking_offers").select("id")
      .eq("work_order_id", job!.workOrderId).eq("state", "offered").single();
    offerId = (data as { id: string }).id;
  });

  test("the contractor sees it as requested, not agreed", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    const booking = page.getByTestId("wo-booking");
    await expect(booking).toBeVisible();
    await expect(booking).toContainText("Requested");
    await expect(booking).toContainText("3 days");
    await expect(booking).toContainText("waiting on their answer");
  });

  test("accepting turns it from requested into confirmed, same dates", async ({ page }) => {
    expect(await rpcAs(contractor!, "respond_to_offer", {
      p_offer_id: offerId, p_action: "accept", p_note: "",
    })).toMatch(/accepted/);

    expect(await bookingState()).toBe("confirmed");
    expect(await dates()).toEqual({ start_date: start, end_date: end });

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    await expect(page.getByTestId("wo-booking")).toContainText("Confirmed");
    await expect(page.getByTestId("wo-booking")).toContainText("Accepted by the contractor");
  });

  test("the booked day on their calendar opens the job", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    // The calendar opens on the current month; the booking is a month or two
    // out, so walk forward until the day is on screen.
    await page.goto("/portal/calendar");
    const cell = page.getByTestId(`calendar-job-${start}`);
    for (let i = 0; i < 4 && !(await cell.count()); i++) {
      await page.getByRole("button", { name: /next|›|→/i }).last().click();
      await page.waitForTimeout(250);
    }
    await expect(cell).toBeVisible();
    await cell.click();
    await expect(page).toHaveURL(new RegExp(`/portal/jobs/${job!.workOrderId}`));
  });

  test("cancelling the booking takes the dates back off the work order", async () => {
    expect(await rpcAs(staff!, "cancel_booking", { p_offer_id: offerId, p_reason: "test" }))
      .toMatch(/cancelled/);

    expect(await dates()).toEqual({ start_date: null, end_date: null });
    expect(await bookingState()).toBe("none");
  });
});
