import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contractorIdForEmail, serviceClient, type LoopFixture } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn } from "../helpers";
import { DESK, INTERIOR_AREAS, PHONE, addDaysIso, createHelpJob, destroyHelpJob, pickCalendarDay, shot } from "./rig";

/**
 * Help capture — scheduling, both roles. Not a gate. See rig.ts.
 * Drives: tray → drag → offer sheet → offered → contractor sees suburb-only offer →
 * decline sheet (backs out) → proposes a date → staff "Needs your decision" → approve →
 * booked (full address) → calendar → reschedule request → staff keeps original →
 * staff cancels booking → re-offer → 24h lapse → contractor "Expired", staff banner.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const F = "scheduling";

let job: LoopFixture | null = null;
let contractorId = "";

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}
const centreOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!db || !staff || !contractor) return;
  contractorId = (await contractorIdForEmail(db, contractor.email)) ?? "";
  if (!contractorId) throw new Error(`no contractors row for ${contractor.email} on this stack`);
  job = await createHelpJob(db, {
    title: "Interior repaint — 3 bedroom house",
    address: "27 Wattle Street, Brunswick VIC 3056",
    contactFirstName: "Priya",
    paymentCents: 486_000,
    areas: INTERIOR_AREAS,
  });
});

test.afterAll(async () => {
  if (!db) return;
  await destroyHelpJob(db, job);
});

test("scheduling — staff offers, contractor responds, both sides captured", async ({ browser }) => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.setTimeout(600_000);

  const cCtx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const c = await cCtx.newPage();
  await signIn(c, contractor!, /\/portal/);
  const company = (await c.locator("header a.who").innerText()).split("\n")[0].trim();

  const sCtx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 2 });
  const s = await sCtx.newPage();
  await signIn(s, staff!, /\/estimates/);
  await s.goto("/pc/schedule");
  await expect(s.getByTestId("lane").first()).toBeVisible({ timeout: 30_000 });
  const tray = s.locator(`[data-testid="tray-job"][data-wo-ref]`).filter({ hasText: /Interior repaint/ }).first();
  await expect(tray).toBeVisible({ timeout: 30_000 });
  const woRef = (await tray.getAttribute("data-wo-ref")) ?? "";
  await shot(s, F, "staff", "01", { fullPage: false });

  // --- drag → offer sheet ----------------------------------------------------
  const lane = `[data-testid="lane"][data-contractor-company="${company}" i]`;
  await expect(s.locator(lane)).toHaveCount(1);
  await dragTo(s, await centreOf(s, `[data-testid="tray-job"][data-wo-ref="${woRef}"]`), await centreOf(s, lane));
  const sendOffer = s.getByRole("button", { name: "Send offer" });
  await expect(sendOffer).toBeVisible();
  await s.getByTestId("offer-note").fill("Client works from home — please keep the hallway clear by 3pm each day.");
  await s.getByTestId("use-suggested-walkthrough").click();
  await s.getByTestId("walkthrough-time").fill("15:00");
  await shot(s, F, "staff", "02", { fullPage: false });
  await sendOffer.click();
  // The send is an RPC plus a board refresh; on a loaded test project it can take a while.
  await expect(s.locator(`[data-testid="tray-job"][data-wo-ref="${woRef}"]`)).toHaveCount(0, { timeout: 30_000 });
  await expect(s.locator(".blk.offered").first()).toBeVisible({ timeout: 30_000 });
  await shot(s, F, "staff", "03", { fullPage: false });

  // the offered block's detail sheet: countdown + "Cancel this offer"
  await s.locator(".blk.offered").first().click();
  await expect(s.getByRole("button", { name: "Cancel this offer" })).toBeVisible();
  await shot(s, F, "staff", "04", { fullPage: false });
  await s.getByRole("button", { name: "Close" }).click();

  const { data: offerRow } = await db!.from("booking_offers").select("id, start_date, end_date").eq("work_order_id", job!.workOrderId).eq("state", "offered").single();
  const offer = offerRow as { id: string; start_date: string; end_date: string | null };

  // --- contractor: the offer, suburb only --------------------------------------
  await c.goto("/portal");
  await shot(c, F, "contractor", "01");
  const requests = await c.goto("/portal/requests");
  const html = (await requests?.text()) ?? "";
  expect(html).not.toContain("Wattle Street"); // privacy gate, checked on the response body
  // Scope everything to OUR offer's card — the shared test contractor may carry
  // earlier offers from other runs under "Earlier offers".
  const card = () => c.locator(".card", { hasText: woRef }).first();
  await expect(card().getByRole("button", { name: /Accept — lock it in/ })).toBeVisible();
  await shot(c, F, "contractor", "02");

  await card().getByRole("link", { name: "View full work order" }).click();
  await expect(c.getByTestId("offer-bar")).toBeVisible();
  await shot(c, F, "contractor", "03");

  await c.goto("/portal/requests");
  await card().getByRole("button", { name: "Decline", exact: true }).click();
  await expect(card().getByRole("heading", { name: "Decline this offer" })).toBeVisible();
  await shot(c, F, "contractor", "04");
  await card().getByRole("button", { name: "Back" }).click();

  // --- propose a new date ------------------------------------------------------
  await card().getByRole("button", { name: "Propose new date" }).click();
  const sheet = card().locator(".sheet");
  await expect(sheet.getByRole("heading", { name: "Propose a new start date" })).toBeVisible();
  const proposed = addDaysIso(offer.start_date, 7);
  await pickCalendarDay(c, sheet, offer.start_date, proposed);
  await sheet.getByPlaceholder(/Optional note/).fill("Finishing another job that week — could start the Monday after.");
  await shot(c, F, "contractor", "05");
  await sheet.getByRole("button", { name: "Send proposal to Paint Group" }).click();
  await expect(card()).toContainText("Proposal sent", { timeout: 20_000 });
  await shot(c, F, "contractor", "06");

  // --- staff: Needs your decision → Approve -----------------------------------
  await s.reload();
  await expect(s.getByRole("heading", { name: "Needs your decision" })).toBeVisible({ timeout: 30_000 });
  await shot(s, F, "staff", "05", { fullPage: false });
  await s.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(s.locator(".blk.accepted").first()).toBeVisible({ timeout: 20_000 });
  await shot(s, F, "staff", "06", { fullPage: false });

  // What the customer got at acceptance (for the staff file — reported, not asserted):
  const { data: ev } = await db!.from("wo_events").select("type").eq("work_order_id", job!.workOrderId);
  console.log("wo_events after acceptance:", (ev as { type: string }[] | null)?.map((e) => e.type).join(", "));

  // --- contractor: booked, full address, calendar ------------------------------
  await c.goto("/portal/requests");
  await expect(card()).toContainText("Booked");
  await shot(c, F, "contractor", "07");
  await c.goto("/portal/jobs");
  await expect(c.locator("body")).toContainText("Interior repaint — 3 bedroom house");
  await shot(c, F, "contractor", "08");
  await c.goto(`/portal/jobs/${job!.workOrderId}`);
  await expect(c.locator("body")).toContainText("Wattle Street");
  await shot(c, F, "contractor", "09");
  await c.goto("/portal/calendar");
  await shot(c, F, "contractor", "10");

  // --- contractor asks to move the job; staff keep the original ---------------
  await c.goto(`/portal/jobs/${job!.workOrderId}`);
  await c.getByRole("button", { name: "Request a new start date" }).click();
  const rs = c.locator(".sheet");
  // Pick a day past the job's own span: tapping a day the job already covers
  // opens the job instead of picking it, and the sheet's Send stays disabled.
  const { data: bookedRow } = await db!.from("booking_offers").select("end_date").eq("work_order_id", job!.workOrderId).eq("state", "accepted").maybeSingle();
  const bookedEnd = (bookedRow as { end_date: string | null } | null)?.end_date ?? proposed;
  const moved = addDaysIso(bookedEnd > proposed ? bookedEnd : proposed, 3);
  await pickCalendarDay(c, rs, proposed, moved);
  await rs.getByPlaceholder(/Why\?/).fill("Running two days behind on the job before.");
  await shot(c, F, "contractor", "11");
  await rs.getByRole("button", { name: "Send request" }).click();
  await expect(c.locator("body")).toContainText("Waiting on Paint Group", { timeout: 20_000 });
  await shot(c, F, "contractor", "12");

  await s.reload();
  await expect(s.locator("body")).toContainText("WANTS TO MOVE THE JOB", { timeout: 30_000 });
  await shot(s, F, "staff", "07", { fullPage: false });
  await s.getByRole("button", { name: "Keep original" }).click();
  await expect(s.locator("body")).not.toContainText("WANTS TO MOVE THE JOB", { timeout: 20_000 });

  // --- staff cancel the booking → back to the tray ----------------------------
  await s.locator(".blk.accepted").first().click();
  const cancel = s.getByRole("button", { name: "Cancel this booking" });
  await expect(cancel).toBeVisible();
  await s.getByPlaceholder(/customer postponed/).fill("Customer postponed — settlement moved a fortnight.");
  await shot(s, F, "staff", "08", { fullPage: false });
  await cancel.click();
  await expect(s.locator(`[data-testid="tray-job"][data-wo-ref="${woRef}"]`)).toHaveCount(1, { timeout: 20_000 });

  // --- the 24-hour clock runs out ---------------------------------------------
  // The cancel action refreshes the board behind the tray card; let that
  // settle before starting a pointer gesture on it.
  await s.waitForLoadState("networkidle");
  await s.waitForTimeout(1500);
  await dragTo(s, await centreOf(s, `[data-testid="tray-job"][data-wo-ref="${woRef}"]`), await centreOf(s, lane));
  await expect(s.getByRole("button", { name: "Send offer" })).toBeVisible();
  await s.getByTestId("use-suggested-walkthrough").click();
  await s.getByTestId("walkthrough-time").fill("15:00");
  await s.getByRole("button", { name: "Send offer" }).click();
  await s.waitForTimeout(3000);
  const sheetErr = await s.locator(".sheet.open .err").allInnerTexts().catch(() => []);
  const { data: afterReoffer } = await db!.from("booking_offers").select("state, expires_at").eq("work_order_id", job!.workOrderId);
  console.log("re-offer: sheet errors =", JSON.stringify(sheetErr), "offers =", JSON.stringify(afterReoffer));
  await expect(s.locator(".blk.offered").first()).toBeVisible({ timeout: 20_000 });
  await db!.from("booking_offers").update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("work_order_id", job!.workOrderId).eq("state", "offered");
  await c.goto("/portal/requests");
  await expect(card()).toContainText("Expired");
  await shot(c, F, "contractor", "13");
  await s.reload();
  await expect(s.getByTestId("lapsed-banner")).toBeVisible({ timeout: 30_000 });
  await shot(s, F, "staff", "09", { fullPage: false });

  await sCtx.close();
  await cCtx.close();
});
