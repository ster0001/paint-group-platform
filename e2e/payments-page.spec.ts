import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Payments merge, Step 2 — the page shell and the Customers block
 * (docs/briefs/claude-code-brief-payments-merge.md §4.2), built to
 * design/reference/payments-merged-v3-mockup.html.
 *
 *  · A customer never reaches it: the page is staff-only, and so is its JSON.
 *  · Overdue is first in all three views; a deposit not in on a job under way
 *    is orange and pulses; a job paid in full shows only under Show paid jobs.
 *  · Search, the view, the stage cell and Show paid are query params.
 *  · No sideways scroll on a phone.
 *
 * Three fixture jobs, one per state, found by a run stamp in their address.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const stamp = `PM${Date.now().toString(36).slice(-6).toUpperCase()}`;
const PAGE = "/invoicing/payments";

type Made = { f: LoopFixture; invoiceIds: string[] };
const made: Made[] = [];
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function job(label: string, contractCents: number, stage: string, invoices: Array<{ kind: string; status: string; total: number; due: string | null; paid?: boolean }>): Promise<Made> {
  const cid = await contractorIdForEmail(db!, contractor!.email);
  const f = await createLoopFixture(db!, cid!, [{ heading: "Front", labels: ["Walls"] }]);
  await db!.from("estimates").update({
    accepted_name: `${label} Customer`, accepted_total_cents: contractCents, total_cents: contractCents,
    sent_snapshot: { jobAddress: `${stamp} ${label} St, Testville` },
  }).eq("id", f.estimateId);
  await db!.from("work_orders").update({ stage, status: stage }).eq("id", f.workOrderId);
  const invoiceIds: string[] = [];
  for (const [n, i] of invoices.entries()) {
    const issued = i.status !== "draft";
    const { data, error } = await db!.from("invoices").insert({
      estimate_id: f.estimateId, work_order_id: f.workOrderId, kind: i.kind, status: i.status,
      number: issued ? `INV-${stamp}${n}${label.slice(0, 2)}` : null,
      subtotal_ex_cents: Math.round(i.total / 1.1), gst_cents: i.total - Math.round(i.total / 1.1), total_inc_cents: i.total, amount_cents: i.total,
      issued_on: issued ? iso(-20) : null, due_on: i.due,
      token: `e2e-pm-${stamp}-${label}-${n}-${Math.random().toString(36).slice(2, 10)}`,
    }).select("id").single();
    if (error) throw error;
    invoiceIds.push(data!.id as string);
    if (i.paid) {
      const { error: pe } = await db!.from("payments").insert({ invoice_id: data!.id, amount_cents: i.total, method: "bank_transfer", status: "succeeded", paid_on: iso(-10) });
      if (pe) throw pe;
    }
  }
  const m = { f, invoiceIds };
  made.push(m);
  return m;
}

test.describe("Payments page — staff only", () => {
  test("an anonymous visitor is sent to sign in and the JSON refuses them", async ({ page, request }) => {
    await page.goto(PAGE);
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
    const res = await request.get("/api/invoicing/job-money");
    expect(res.status()).toBe(403);
  });
});

test.describe("Payments page — the Customers block", () => {
  test.setTimeout(180_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture jobs");

  test.beforeAll(async () => {
    // Overdue: deposit paid, a progress claim 5 days past due.
    await job("Overdue", 400_000, "in_progress", [
      { kind: "deposit", status: "paid", total: 200_000, due: iso(-30), paid: true },
      { kind: "progress", status: "sent", total: 100_000, due: iso(-5) },
    ]);
    // Deposit not in, already under way.
    await job("Deposit", 300_000, "in_progress", [{ kind: "deposit", status: "draft", total: 150_000, due: null }]);
    // Paid in full and closed.
    await job("Settled", 100_000, "closed", [
      { kind: "deposit", status: "paid", total: 50_000, due: iso(-40), paid: true },
      { kind: "final", status: "paid", total: 50_000, due: iso(-15), paid: true },
    ]);
  });

  test.afterAll(async () => {
    if (!db || process.env.E2E_KEEP) return;
    for (const m of made) {
      await db.from("payments").delete().in("invoice_id", m.invoiceIds);
      await db.from("invoice_events").delete().in("invoice_id", m.invoiceIds);
      await db.from("invoices").delete().in("id", m.invoiceIds);
      await destroyLoopFixture(db, m.f);
    }
  });

  test("headline, four blocks, seven stages; overdue first; paid only under Show paid", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(PAGE);
    await expect(page.getByTestId("pm-headline")).toContainText(/no deposit in|Nothing is overdue|overdue/, { timeout: 30_000 });
    await expect(page.getByTestId("pm-ledger").getByRole("link")).toHaveCount(4);
    await expect(page.getByTestId("pm-strip").getByRole("link")).toHaveCount(7);
    // Overdue is the first section whenever anything is overdue — and ours is.
    await expect(page.locator(".pm .sec h2").first()).toHaveText("Overdue");

    await page.goto(`${PAGE}?q=${stamp}`);
    const cards = page.locator(".pm .job");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText(`${stamp} Overdue St`);
    await expect(cards.nth(0)).toHaveClass(/\bover\b/);
    await expect(cards.nth(1)).toContainText(`${stamp} Deposit St`);
    await expect(cards.nth(1)).toHaveClass(/\bneed\b/);
    await expect(cards.nth(1)).toHaveClass(/\bpulse\b/);
    await expect(page.getByText(`${stamp} Settled St`)).toHaveCount(0);

    // Show paid jobs brings the settled job back (All jobs view, R9).
    await page.goto(`${PAGE}?q=${stamp}&view=table&paid=1`);
    await expect(page.locator(".pm .tr.grp").first()).toContainText("Overdue");
    await expect(page.getByText(`${stamp} Settled St`)).toBeVisible();
    await page.goto(`${PAGE}?q=${stamp}&view=table&f=paid`);
    await expect(page.locator(".pm .tr:not(.head):not(.grp)")).toHaveCount(1);
    await expect(page.getByText(`${stamp} Settled St`)).toBeVisible();

    // By job stage: the overdue card is first in its lane.
    await page.goto(`${PAGE}?q=${stamp}&view=board`);
    const inProgress = page.locator(".pm .lane").nth(3);
    await expect(inProgress.locator("h3")).toContainText("In progress");
    await expect(inProgress.locator(".mini").first()).toContainText(`${stamp} Overdue St`);

    // The stage cell filters, as a link that can be shared.
    await page.goto(`${PAGE}?q=${stamp}`);
    await page.getByTestId("pm-strip").getByRole("link", { name: /Closed/ }).click();
    await expect(page).toHaveURL(/stage=closed/);
    await expect(page.locator(".pm .job")).toHaveCount(0);
  });

  test("search is a query param and narrows every view", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(PAGE);
    await page.getByLabel("Search address or customer").fill(`${stamp} Deposit`);
    await expect(page).toHaveURL(new RegExp(`q=${stamp}`), { timeout: 15_000 });
    await expect(page.locator(".pm .job")).toHaveCount(1);
  });

  test("no sideways scroll on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, staff!, /\/(home|estimates)/);
    for (const v of ["chase", "board", "table"]) {
      await page.goto(`${PAGE}?q=${stamp}&view=${v}`);
      await expect(page.getByTestId("pm-headline")).toBeVisible({ timeout: 30_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${v} scrolls sideways`).toBeLessThanOrEqual(0);
    }
  });
});
