import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contractorIdForEmail, rpcAs, serviceClient, type LoopFixture } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn } from "../helpers";
import {
  DESK, INTERIOR_AREAS, PHONE, caption, createHelpJob, daysFromNow, destroyHelpJob, installCaptions, iso,
  startRecording, writeGif,
} from "./rig";

/**
 * Walkthrough GIFs for docs/help/self-invoicing — one per role. Not a gate.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const F = "self-invoicing";

let contractorId = "";
const jobs: LoopFixture[] = [];

async function assignedJob(): Promise<LoopFixture> {
  const job = await createHelpJob(db!, {
    title: "Interior repaint — 3 bedroom house", address: "27 Wattle Street, Brunswick VIC 3056",
    contactFirstName: "Priya", paymentCents: 486_000, areas: INTERIOR_AREAS,
    assigned: { contractorId, startDate: iso(daysFromNow(-3)), stage: "in_progress" },
  });
  jobs.push(job);
  const base = {
    work_order_id: job.workOrderId, status: "contractor_accepted",
    contractor_accepted_at: new Date().toISOString(), customer_responded_at: new Date().toISOString(),
    contractor_rate_cents: 6_000,
  };
  await db!.from("wo_variations").insert([
    { ...base, category: "extra_scope", comment: "Laundry ceiling — added on site", credit: false, price_cents: 42_000, est_hours: 3, contractor_delta_cents: 18_000 },
    { ...base, category: "scope_removed", comment: "Bedroom 2 skirting — customer keeping as is", credit: true, price_cents: 14_000, est_hours: 1, contractor_delta_cents: 6_000 },
  ]);
  return job;
}

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

test("self-invoicing · contractor walkthrough", async ({ browser }) => {
  test.skip(!db || !staff || !contractor, missingCreds("CONTRACTOR"));
  test.setTimeout(300_000);
  const job = await assignedJob();

  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const c = await ctx.newPage();
  await installCaptions(c);
  await signIn(c, contractor!, /\/portal/);
  const rec = startRecording(c);

  await c.goto("/portal/money");
  await expect(c.getByTestId("open-claim")).toBeVisible();
  await caption(c, "1 · Invoicing: + New invoice appears whenever a job of yours has money owing.");
  await c.waitForTimeout(1500);
  await c.getByTestId("open-claim").click();
  const sel = c.getByTestId("claim-job");
  if (await sel.count()) {
    const label = (await sel.locator("option", { hasText: /Interior repaint/ }).first().textContent()) ?? "";
    await sel.selectOption({ label }).catch(() => undefined);
  }
  await caption(c, "2 · A progress claim at any time: pick 25%, 50%, a custom %, an amount or line items.");
  await c.getByTestId("claim-pct-25").click();
  await c.waitForTimeout(1500);
  await caption(c, "3 · The button shows the exact figure. Send invoice.");
  await c.getByTestId("send-claim").click();
  await expect(c).toHaveURL(/\/portal\/money\/[0-9a-f-]+$/, { timeout: 20_000 });
  await expect(c.getByTestId("ci-status")).toContainText("With the office");
  await caption(c, "4 · It has a number and is with the office. Download the PDF any time.");
  await c.waitForTimeout(2200);

  const { data } = await db!.rpc("contractor_invoice_draft", { p_work_order_id: job.workOrderId });
  const finalId = String(data).slice(3);
  await c.goto("/portal/money");
  await caption(c, "5 · At sign-off the final invoice is drafted for you: Ready to submit.");
  await c.waitForTimeout(1800);
  await c.goto(`/portal/money/${finalId}`);
  await expect(c.getByTestId("submit-invoice")).toBeVisible();
  await caption(c, "6 · Check the lines: contract, approved variations, credits, less already invoiced.");
  await c.waitForTimeout(2600);
  await caption(c, "7 · Submit invoice — the figures lock and the office is told.");
  await c.getByTestId("submit-invoice").click();
  await expect(c.getByTestId("ci-status")).toContainText("With the office", { timeout: 15_000 });
  await c.waitForTimeout(1800);

  const frames = await rec.stop();
  await ctx.close();
  console.log("gif:", JSON.stringify(await writeGif(frames, F, "contractor-walkthrough", { width: 390 })));
});

test("self-invoicing · staff walkthrough", async ({ browser }) => {
  test.skip(!db || !staff || !contractor, missingCreds("STAFF"));
  test.setTimeout(300_000);
  const job = await assignedJob();
  const claimed = await rpcAs(contractor!, "contractor_invoice_request", { p_work_order_id: job.workOrderId, p_mode: "percent", p_value: 25 });
  if (!/^ok:/.test(claimed)) throw new Error(`contractor_invoice_request: ${claimed}`);
  const claimId = claimed.slice(3);

  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 1 });
  const s = await ctx.newPage();
  await installCaptions(s);
  await signIn(s, staff!, /\/estimates/);
  const rec = startRecording(s);

  await s.goto("/invoicing?tab=pay");
  await expect(s.getByTestId(`payable-${claimId}`)).toBeVisible({ timeout: 60_000 });
  await caption(s, "1 · Payments → Payables. To approve: what contractors have submitted.", { top: 96 });
  await s.getByTestId(`payable-${claimId}`).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await s.waitForTimeout(2000);
  await caption(s, "2 · Read the PDF, then Approve.", { top: 96 });
  await s.getByTestId(`approve-ci-${claimId}`).click();
  await expect(s.getByTestId(`pay-ci-${claimId}`)).toBeVisible({ timeout: 90_000 }); // Payables renders slowly on the volume-data stack
  await s.waitForTimeout(1500);
  await caption(s, "3 · Pay by bank transfer, then Mark paid: the bank reference and the payment date.", { top: 96 });
  const answers = ["EFT-HELP-0002", iso(new Date())];
  s.on("dialog", (d) => d.accept(answers.shift() ?? ""));
  await s.getByTestId(`pay-ci-${claimId}`).click();
  await expect(s.getByTestId(`payable-${claimId}`)).toContainText("Paid", { timeout: 90_000 });
  await caption(s, "4 · Paid. The remittance advice goes to the contractor's portal.", { top: 96 });
  await s.waitForTimeout(2400);

  const frames = await rec.stop();
  await ctx.close();
  console.log("gif:", JSON.stringify(await writeGif(frames, F, "staff-walkthrough", { width: 960 })));
});
