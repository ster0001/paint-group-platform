import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contractorIdForEmail, rpcAs, serviceClient, type LoopFixture } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn } from "../helpers";
import {
  DESK, INTERIOR_AREAS, PHONE, caption, createHelpJob, daysFromNow, destroyHelpJob, installCaptions, iso,
  startRecording, writeGif,
} from "./rig";

/**
 * Walkthrough GIFs for docs/help/scheduling — one per role. Not a gate. Each
 * test performs its help file's steps with a caption per step while frames are
 * captured, then writes media/<role>-walkthrough.gif. See README#walkthroughs.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const F = "scheduling";

let contractorId = "";
const jobs: LoopFixture[] = [];

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
    await page.waitForTimeout(60);
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
  if (!contractorId) throw new Error(`no contractors row for ${contractor.email}`);
});

test.afterAll(async () => {
  if (!db) return;
  for (const j of jobs) await destroyHelpJob(db, j);
});

test("scheduling · contractor walkthrough", async ({ browser }) => {
  test.skip(!db || !staff || !contractor, missingCreds("CONTRACTOR"));
  test.setTimeout(300_000);
  const job = await createHelpJob(db!, {
    title: "Interior repaint — 3 bedroom house", address: "27 Wattle Street, Brunswick VIC 3056",
    contactFirstName: "Priya", paymentCents: 486_000, areas: INTERIOR_AREAS,
  });
  jobs.push(job);
  const sent = await rpcAs(staff!, "send_offer", {
    p_work_order_id: job.workOrderId, p_contractor_id: contractorId,
    p_start: iso(daysFromNow(3)), p_end: iso(daysFromNow(7)),
    p_note: "Client works from home — please keep the hallway clear by 3pm each day.",
  });
  if (!/^ok|offered/.test(sent)) throw new Error(`send_offer: ${sent}`);

  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const c = await ctx.newPage();
  await installCaptions(c);
  await signIn(c, contractor!, /\/portal/);
  const rec = startRecording(c);

  await c.goto("/portal");
  await caption(c, "1 · A new offer lands on Home with a 24-hour clock.");
  await c.waitForTimeout(1500);
  await c.goto("/portal/requests");
  await caption(c, "2 · Requests: the dates, calculated hours and your price. Suburb only until you accept.");
  await c.waitForTimeout(2200);
  const { data: woRow } = await db!.from("work_orders").select("wo_ref").eq("id", job.workOrderId).single();
  const card = c.locator(".card", { hasText: (woRow as { wo_ref: string }).wo_ref }).first();
  await card.getByRole("link", { name: "View full work order" }).click();
  await expect(c.getByTestId("offer-bar")).toBeVisible();
  await caption(c, "3 · View full work order: the clock and Accept stay pinned while you read.");
  await c.waitForTimeout(2200);
  await c.goto("/portal/requests");
  await caption(c, "4 · Tap Accept — lock it in.");
  await c.waitForTimeout(800);
  await card.getByRole("button", { name: /Accept — lock it in/ }).click();
  await expect(card).toContainText("Booked", { timeout: 20_000 });
  await caption(c, "5 · Booked. The full address and customer details unlock on your job.");
  await c.waitForTimeout(1800);
  await c.goto("/portal/jobs");
  await caption(c, "6 · Jobs → Coming up. Open the work order for the address, colours and scope.");
  await c.waitForTimeout(1800);
  await c.goto(`/portal/jobs/${job.workOrderId}`);
  await caption(c, "7 · Start the job unlocks once the office finishes the pre-start list.");
  await c.waitForTimeout(2200);

  const frames = await rec.stop();
  await ctx.close();
  console.log("gif:", JSON.stringify(await writeGif(frames, F, "contractor-walkthrough", { width: 390 })));
});

test("scheduling · staff walkthrough", async ({ browser }) => {
  test.skip(!db || !staff || !contractor, missingCreds("STAFF"));
  test.setTimeout(300_000);
  const job = await createHelpJob(db!, {
    title: "Exterior repaint — weatherboard house", address: "14 Banksia Court, Northcote VIC 3070",
    contactFirstName: "Daniel", paymentCents: 786_000,
    areas: [
      { title: "Front", surfaces: [{ label: "Weatherboards", hours: 8 }, { label: "Windows × 3", hours: 4 }] },
      { title: "Rear", surfaces: [{ label: "Weatherboards", hours: 6 }] },
    ],
  });
  jobs.push(job);

  const cCtx = await browser.newContext({ viewport: PHONE });
  const c = await cCtx.newPage();
  await signIn(c, contractor!, /\/portal/);
  const company = (await c.locator("header a.who").innerText()).split("\n")[0].trim();
  await cCtx.close();

  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 1 });
  const s = await ctx.newPage();
  await installCaptions(s);
  await signIn(s, staff!, /\/estimates/);
  const rec = startRecording(s);

  await s.goto("/pc/schedule");
  await expect(s.getByTestId("lane").first()).toBeVisible({ timeout: 60_000 });
  const tray = s.locator(`[data-testid="tray-job"]`).filter({ hasText: /Exterior repaint/ }).first();
  await expect(tray).toBeVisible();
  const woRef = (await tray.getAttribute("data-wo-ref")) ?? "";
  await caption(s, "1 · Projects → Schedule. Unscheduled jobs wait in the tray on the left.", { top: 96 });
  await s.waitForTimeout(1800);
  await caption(s, "2 · Drag the job onto the painter's row, landing on the start day.", { top: 96 });
  const lane = `[data-testid="lane"][data-contractor-company="${company}" i]`;
  await dragTo(s, await centreOf(s, `[data-testid="tray-job"][data-wo-ref="${woRef}"]`), await centreOf(s, lane));
  await expect(s.getByRole("button", { name: "Send offer" })).toBeVisible();
  await caption(s, "3 · Check the dates and price, add a note, confirm the walkthrough with the client.", { top: 96 });
  await s.getByTestId("offer-note").fill("Ladder access at the rear only — the side path is narrow.");
  await s.getByTestId("use-suggested-walkthrough").click();
  await s.getByTestId("walkthrough-time").fill("15:00");
  await s.waitForTimeout(1500);
  await caption(s, "4 · Send offer. Nothing reaches the customer until the painter accepts.", { top: 96 });
  await s.getByRole("button", { name: "Send offer" }).click();
  await expect(s.locator(".blk.offered").first()).toBeVisible({ timeout: 20_000 });
  await s.waitForTimeout(1200);
  await caption(s, "5 · The amber block counts down 24 hours. Green once accepted.", { top: 96 });
  await s.waitForTimeout(1800);
  await s.locator(".blk.offered").first().click();
  await expect(s.getByRole("button", { name: "Cancel this offer" })).toBeVisible();
  await caption(s, "6 · Click the block: details, cancel with a reason, or open the job.", { top: 96 });
  await s.waitForTimeout(2400);

  const frames = await rec.stop();
  await ctx.close();
  console.log("gif:", JSON.stringify(await writeGif(frames, F, "staff-walkthrough", { width: 960 })));
});
