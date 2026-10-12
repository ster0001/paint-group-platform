import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test, userIdFor } from "./helpers";
import { accessTokenFor, contractorIdForEmail, rpcAs, serviceClient } from "./fixtures/woLoop";
import { cleanupPaymentsJobs, isoDay, makePaymentsJob, type PaymentsJob } from "./fixtures/paymentsJobs";

/**
 * Payments merge, Step 5 — the Contractors block (docs/briefs/claude-code-brief-payments-merge.md §4.5).
 *
 *  · Sections: past the pay-by date first, then to approve, approved to pay.
 *  · Each row says what the customer has paid on that job.
 *  · Approve and ✓ Paid are one press with Undo; Undo leaves an event trail.
 *  · The remittance is claimed once the Undo window closes; then Undo is refused.
 *  · "By contractor": Approve all writes one event per invoice.
 *  · The To approve total equals the old Payables tile on the same data.
 *  · The contractor still sees only their own invoices.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const stamp = `PC5${Date.now().toString(36).slice(-5).toUpperCase()}`;
const PAGE = "/invoicing/payments?tab=con";
const made: PaymentsJob[] = [];
let seq = 0;

async function ci(j: PaymentsJob, status: "submitted" | "approved", totalCents: number, dueOn: string | null, contractorId?: string) {
  seq += 1;
  const cid = contractorId ?? (await contractorIdForEmail(db!, contractor!.email))!;
  const { data, error } = await db!.from("contractor_invoices").insert({
    work_order_id: j.f.workOrderId, contractor_id: cid, status, number: `CI-${stamp}${seq}`,
    subtotal_ex_cents: totalCents, total_inc_cents: totalCents, claimed_ex_cents: totalCents, due_on: dueOn,
    submitted_at: new Date().toISOString(), approved_at: status === "approved" ? new Date(Date.now() - 86_400_000).toISOString() : null,
  }).select("id").single();
  if (error) throw error;
  return data!.id as string;
}
const ciRow = async (id: string) => {
  const { data, error } = await db!.from("contractor_invoices").select("status, approved_by, remittance_sent_at").eq("id", id).single();
  if (error) throw error;
  return data as { status: string; approved_by: string | null; remittance_sent_at: string | null };
};
const ciEvents = async (id: string) => {
  const { data } = await db!.from("wo_events").select("type").eq("meta->>contractor_invoice_id", id).order("created_at");
  return (data ?? []).map((e) => (e as { type: string }).type);
};
const row = (page: Page, number: string) => page.locator(".pm .prow", { hasText: number });

test.describe("Payments → Contractors — as staff", () => {
  test.setTimeout(240_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.afterAll(async () => {
    if (!db || process.env.E2E_KEEP) return;
    await cleanupPaymentsJobs(db, made);
  });

  test("sections, the customer line, one-press Approve and Paid with Undo, then the remittance after the window", async ({ page }) => {
    const unpaidJob = await makePaymentsJob(db!, contractor!.email, stamp, "Nopaid", { contractCents: 500_000, stage: "closed", invoices: [] });
    const halfJob = await makePaymentsJob(db!, contractor!.email, stamp, "Halfpaid", {
      contractCents: 400_000, stage: "qa", invoices: [{ kind: "deposit", status: "paid", total: 200_000, due: isoDay(-20), paid: true }],
    });
    const lateJob = await makePaymentsJob(db!, contractor!.email, stamp, "Latepay", { contractCents: 300_000, stage: "closed", invoices: [] });
    made.push(unpaidJob, halfJob, lateJob);
    const sub = await ci(unpaidJob, "submitted", 250_000, isoDay(6));
    const appr = await ci(halfJob, "approved", 180_000, isoDay(5));
    const late = await ci(lateJob, "approved", 90_000, isoDay(-3));
    const staffId = await userIdFor(staff!);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`${PAGE}&q=${stamp}`);
    await expect(page.locator(".pm [data-testid=pm-contractors] .sec h2").first()).toHaveText("Past the pay-by date", { timeout: 30_000 });
    await expect(page.locator(".pm [data-testid=pm-contractors] .sec h2")).toHaveText(["Past the pay-by date", "To approve", "Approved, to pay"]);
    await expect(row(page, `CI-${stamp}1`)).toContainText("Customer has paid nothing yet");
    await expect(row(page, `CI-${stamp}2`)).toContainText("Customer has paid $2,000.00 of $4,000.00");
    await expect(row(page, `CI-${stamp}3`)).toContainText("3 days past pay-by");

    // Approve, one press, then Undo.
    const toast = page.getByTestId("pm-toast");
    await row(page, `CI-${stamp}1`).getByRole("button", { name: "Approve" }).click();
    await expect(toast).toContainText(`Approved CI-${stamp}1, $2,500.00`);
    expect(await ciRow(sub)).toMatchObject({ status: "approved", approved_by: staffId });
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toContainText("Undone.");
    expect((await ciRow(sub)).status).toBe("submitted");
    expect(await ciEvents(sub)).toEqual(expect.arrayContaining(["contractor_invoice_approved", "contractor_invoice_approval_undone"]));

    // ✓ Paid, one press, then Undo — the remittance never went.
    await page.reload();
    await row(page, `CI-${stamp}2`).getByRole("button", { name: "✓ Paid $1,800.00" }).click();
    await expect(toast).toContainText(`Marked CI-${stamp}2 paid`);
    expect((await ciRow(appr)).status).toBe("paid");
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toContainText("Undone.");
    expect(await ciRow(appr)).toMatchObject({ status: "approved", remittance_sent_at: null });
    expect(await ciEvents(appr)).toEqual(expect.arrayContaining(["contractor_invoice_paid", "contractor_invoice_payment_undone"]));

    // Paid again and left alone: the remittance is claimed when the window closes, and Undo is then refused.
    await page.reload();
    await row(page, `CI-${stamp}2`).getByRole("button", { name: "✓ Paid $1,800.00" }).click();
    await expect(toast).toContainText(`Marked CI-${stamp}2 paid`);
    await expect.poll(async () => (await ciRow(appr)).remittance_sent_at, { timeout: 25_000 }).not.toBeNull();
    expect(await rpcAs(staff!, "contractor_invoice_unpay", { p_id: appr })).toBe("error:remittance_sent");
    expect((await ciRow(late)).status).toBe("approved");
  });

  test("By contractor: Approve all writes one event per invoice", async ({ page }) => {
    const a = await makePaymentsJob(db!, contractor!.email, stamp, "Groupa", { contractCents: 200_000, stage: "closed", invoices: [] });
    const b = await makePaymentsJob(db!, contractor!.email, stamp, "Groupb", { contractCents: 200_000, stage: "closed", invoices: [] });
    made.push(a, b);
    const c1 = await ci(a, "submitted", 50_000, isoDay(7));
    const c2 = await ci(b, "submitted", 60_000, isoDay(7));
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`${PAGE}&cby=con&q=${encodeURIComponent(`${stamp} Group`)}`);
    const approveAll = page.getByRole("button", { name: "Approve all 2" });
    await expect(approveAll).toBeVisible({ timeout: 30_000 });
    await approveAll.click();
    await expect(page.getByTestId("pm-toast")).toContainText("Approved 2 invoices");
    for (const id of [c1, c2]) {
      expect((await ciRow(id)).status).toBe("approved");
      expect((await ciEvents(id)).filter((t) => t === "contractor_invoice_approved")).toHaveLength(1);
    }
  });

  test("the To approve total equals the old Payables tile", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/invoicing?tab=pay");
    const tile = (await page.getByTestId("tile-to-approve").textContent()) ?? "";
    await page.goto(PAGE);
    await expect(page.getByTestId("pm-headline")).toBeVisible({ timeout: 30_000 });
    const sec = page.locator(".pm [data-testid=pm-contractors] .sec", { has: page.locator("h2", { hasText: "To approve" }) });
    // No section at all means nothing is waiting for approval: $0, the same as the tile.
    const total = (await sec.count()) ? ((await sec.locator(".tot").textContent()) ?? "") : "$0";
    const dollars = (s: string) => Math.round(Number((s.match(/\$[\d,]+(\.\d+)?/)?.[0] ?? "$0").replace(/[$,]/g, "")));
    expect(dollars(total)).toBe(dollars(tile));
  });

  test("a contractor still sees only their own invoices", async () => {
    const mine = await contractorIdForEmail(db!, contractor!.email);
    const { data: others } = await db!.from("contractors").select("id").neq("id", mine!).limit(1);
    test.skip(!others?.length, "needs a second contractor on the test project");
    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Someoneelse", { contractCents: 100_000, stage: "closed", invoices: [] });
    made.push(j);
    const theirs = await ci(j, "submitted", 10_000, isoDay(7), (others![0] as { id: string }).id);
    const token = await accessTokenFor(contractor!);
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/contractor_invoices?select=id,contractor_id`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${token}` },
    });
    const rows = (await res.json()) as Array<{ id: string; contractor_id: string }>;
    expect(rows.every((r) => r.contractor_id === mine)).toBe(true);
    expect(rows.map((r) => r.id)).not.toContain(theirs);
  });
});
