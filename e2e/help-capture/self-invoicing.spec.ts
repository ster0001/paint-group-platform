import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contractorIdForEmail, serviceClient, type LoopFixture } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn } from "../helpers";
import { DESK, INTERIOR_AREAS, PHONE, createHelpJob, destroyHelpJob, shot } from "./rig";

/**
 * Help capture — contractor self-invoicing, both roles. Not a gate. See rig.ts.
 * Drives: profile gate → Invoicing tab → a 30% payment claim → the sign-off
 * draft with a variation and a deduction → submit → office Payables → approve →
 * mark paid → remittance back in the portal.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const F = "self-invoicing";

let job: LoopFixture | null = null;
let contractorId = "";
let profile: { abn: string | null; address: string | null; gst_registered: boolean } | null = null;

const OFFER = 486_000;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!db || !staff || !contractor) return;
  contractorId = (await contractorIdForEmail(db, contractor.email)) ?? "";
  if (!contractorId) throw new Error(`no contractors row for ${contractor.email} on this stack`);
  const { data: p } = await db.from("contractors").select("abn, address, gst_registered").eq("id", contractorId).single();
  profile = p as typeof profile;
  const start = new Date(); start.setDate(start.getDate() - 3);
  job = await createHelpJob(db, {
    title: "Interior repaint — 3 bedroom house",
    address: "27 Wattle Street, Brunswick VIC 3056",
    contactFirstName: "Priya",
    paymentCents: OFFER,
    areas: INTERIOR_AREAS,
    assigned: { contractorId, startDate: start.toISOString().slice(0, 10), stage: "in_progress" },
  });
  // Two settled variations, so the sign-off draft has something to show:
  // an accepted addition and a credit for scope that came out.
  const base = {
    work_order_id: job.workOrderId, status: "contractor_accepted",
    contractor_accepted_at: new Date().toISOString(), customer_responded_at: new Date().toISOString(),
    contractor_rate_cents: 6_000,
  };
  await db.from("wo_variations").insert([
    { ...base, category: "extra_scope", comment: "Laundry ceiling — added on site", credit: false, price_cents: 42_000, est_hours: 3, contractor_delta_cents: 18_000 },
    { ...base, category: "scope_removed", comment: "Bedroom 2 skirting — customer keeping as is", credit: true, price_cents: 14_000, est_hours: 1, contractor_delta_cents: 6_000 },
  ]);
});

test.afterAll(async () => {
  if (!db) return;
  await destroyHelpJob(db, job);
  if (profile) await db.from("contractors").update(profile).eq("id", contractorId);
});

test("self-invoicing — contractor claims, submits; office approves and pays", async ({ browser }) => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.setTimeout(600_000);

  const cCtx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const c = await cCtx.newPage();
  await signIn(c, contractor!, /\/portal/);

  // --- the profile gate ---------------------------------------------------------
  await db!.from("contractors").update({ abn: null }).eq("id", contractorId);
  await c.goto("/portal/money");
  await expect(c.locator("body")).toContainText("Not ready to invoice");
  await shot(c, F, "contractor", "01");
  await db!.from("contractors").update({ abn: profile!.abn ?? "12 345 678 901", address: profile!.address ?? "1 Test St, Melbourne" }).eq("id", contractorId);
  await c.goto("/portal/profile");
  await shot(c, F, "contractor", "02");

  // --- a progress claim at any time ----------------------------------------------
  await c.goto("/portal/money");
  await expect(c.getByTestId("open-claim")).toBeVisible();
  await shot(c, F, "contractor", "03");
  await c.getByTestId("open-claim").click();
  const jobSelect = c.getByTestId("claim-job");
  if (await jobSelect.count()) await jobSelect.selectOption({ label: await jobSelect.locator("option", { hasText: /Interior repaint/ }).first().textContent() ?? "" }).catch(() => undefined);
  await c.getByTestId("claim-pct-25").click();
  await expect(c.getByTestId("send-claim")).toContainText("$1,245.00");
  await shot(c, F, "contractor", "04");
  await c.getByTestId("send-claim").click();
  await expect(c).toHaveURL(/\/portal\/money\/[0-9a-f-]+$/, { timeout: 20_000 });
  await expect(c.getByTestId("ci-status")).toContainText("With the office");
  await shot(c, F, "contractor", "05");
  const claimId = c.url().split("/").pop()!;

  // --- the sign-off draft: offer + variations − deductions − already claimed ----
  const { data } = await db!.rpc("contractor_invoice_draft", { p_work_order_id: job!.workOrderId });
  expect(String(data)).toMatch(/^ok:/);
  const finalId = String(data).slice(3);
  await c.goto("/portal/money");
  await shot(c, F, "contractor", "06");
  await c.goto(`/portal/money/${finalId}`);
  await expect(c.getByTestId("ci-status")).toContainText("Ready to check & submit");
  await expect(c.getByTestId("ci-heading")).toHaveText("INVOICE");
  await shot(c, F, "contractor", "07");
  await c.getByTestId("submit-invoice").click();
  await expect(c.getByTestId("ci-status")).toContainText("With the office", { timeout: 15_000 });
  await shot(c, F, "contractor", "08");

  // --- the office: Payables → approve → mark paid -------------------------------
  const sCtx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 2 });
  const s = await sCtx.newPage();
  await signIn(s, staff!, /\/estimates/);
  await s.goto("/invoicing?tab=pay");
  await expect(s.getByTestId(`payable-${claimId}`)).toBeVisible();
  await expect(s.getByTestId(`payable-${finalId}`)).toBeVisible();
  await shot(s, F, "staff", "01", { fullPage: false });
  await s.getByTestId(`approve-ci-${claimId}`).click();
  await expect(s.getByTestId(`pay-ci-${claimId}`)).toBeVisible({ timeout: 15_000 });
  await shot(s, F, "staff", "02", { fullPage: false });
  const answers = ["EFT-HELP-0001", new Date().toISOString().slice(0, 10)];
  s.on("dialog", (d) => d.accept(answers.shift() ?? ""));
  await s.getByTestId(`pay-ci-${claimId}`).click();
  await expect(s.getByTestId(`payable-${claimId}`)).toContainText("Paid", { timeout: 15_000 });
  await shot(s, F, "staff", "03", { fullPage: false });

  // --- back in the portal: paid, remittance attached ------------------------------
  await expect.poll(async () => {
    const { data: ci } = await db!.from("contractor_invoices").select("remittance_pdf_path").eq("id", claimId).single();
    return (ci as { remittance_pdf_path: string | null }).remittance_pdf_path;
  }, { timeout: 45_000, intervals: [1_500] }).not.toBeNull().catch(() => console.log("remittance PDF did not render on this stack"));
  await c.goto(`/portal/money/${claimId}`);
  await expect(c.getByTestId("ci-status")).toContainText("Paid");
  await shot(c, F, "contractor", "09");
  await c.goto("/portal/money");
  await shot(c, F, "contractor", "10");

  await sCtx.close();
  await cCtx.close();
});
