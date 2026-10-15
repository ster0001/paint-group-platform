import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { rpcAs, serviceClient } from "./fixtures/woLoop";
import { cleanupPaymentsJobs, isoDay, makePaymentsJob, type PaymentsJob } from "./fixtures/paymentsJobs";

/**
 * Tom, 15 Oct 2026 (8 Penderel Court): the job was signed off with its 50%
 * deposit sent but never paid. The final drafted at sign-off netted that deposit
 * off, so nothing could raise ONE invoice for the whole job — "Invoice in full"
 * drafts the balance only, and the row's primary stays "✓ Paid" on the deposit.
 *
 *  · A sent, unpaid deposit card offers "Cancel, invoice in full": one RPC voids
 *    the unpaid deposit (and any unpaid progress claim) and drafts a final for
 *    the whole contract, in one transaction. The old number is burnt as the rules
 *    require; the final then goes out through the ordinary Send.
 *  · Money already paid on a deposit stops it: the ordinary final nets that off.
 *  · The customer's link for the cancelled deposit says so; the final shows the
 *    whole job.
 *  · A customer (anonymous session) can't call it.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const stamp = `PF${Date.now().toString(36).slice(-6).toUpperCase()}`;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const made: PaymentsJob[] = [];

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const panel = (page: Page) => page.getByTestId("pm-panel");
type Inv = { id: string; kind: string; status: string; number: string | null; total_inc_cents: number; voided_reason: string | null; token: string };
const invoicesOf = async (j: PaymentsJob): Promise<Inv[]> => {
  const { data, error } = await db!.from("invoices").select("id, kind, status, number, total_inc_cents, voided_reason, token")
    .eq("estimate_id", j.f.estimateId).order("created_at");
  if (error) throw error;
  return data as Inv[];
};

test.describe("Cancel an unpaid deposit and invoice in full — a customer can't reach it", () => {
  test("an anonymous session is refused", async () => {
    const visitor = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await visitor.auth.signInAnonymously()).error).toBeNull();
    const { data, error } = await visitor.rpc("invoice_final_in_full", { p_estimate_id: "00000000-0000-4000-8000-000000000000" });
    expect(error?.code === "42501" || data === "error:not_staff", `answered ${JSON.stringify(data ?? error)}`).toBe(true);
  });
});

test.describe("Cancel an unpaid deposit and invoice in full — as staff", () => {
  test.setTimeout(240_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.afterAll(async () => {
    if (!db || process.env.E2E_KEEP) return;
    await cleanupPaymentsJobs(db, made);
  });

  test("the deposit is cancelled, one final for the whole job is drafted and sent, the customer sees both", async ({ page, browser }) => {
    // Penderel Court as it stood: $1,200.10 job, closed, 50% deposit viewed and unpaid, no final.
    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Penderel", {
      contractCents: 120_010, stage: "closed", startDate: isoDay(-3),
      invoices: [{ kind: "deposit", status: "viewed", total: 60_005, due: isoDay(2) }],
    });
    made.push(j);
    const [deposit] = await invoicesOf(j);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/invoicing/job/${j.f.estimateId}`);
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    const depositCard = panel(page).locator(".inv[data-kind=deposit]");
    await expect(depositCard).toContainText(deposit.number!);

    page.once("dialog", (d) => { expect(d.message()).toContain(money(120_010)); void d.accept(); });
    await depositCard.getByTestId("final-in-full").click();

    // The deposit is void; the final for the whole job sits beside it as a draft.
    const finalCard = panel(page).locator(".inv[data-kind=final]");
    await expect(finalCard).toBeVisible({ timeout: 30_000 });
    await expect(finalCard).toContainText("Not sent yet");
    await expect(finalCard).toContainText(money(120_010));
    await expect(depositCard).toContainText("Void");
    await expect(depositCard.getByTestId("final-in-full")).toHaveCount(0);

    let invs = await invoicesOf(j);
    const dep = invs.find((i) => i.id === deposit.id)!;
    expect(dep.status).toBe("void");
    expect(dep.voided_reason).toMatch(/final invoice/i);
    const finals = invs.filter((i) => i.kind === "final");
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ status: "draft", total_inc_cents: 120_010 });
    const { data: ev } = await db!.from("invoice_events").select("type").eq("invoice_id", deposit.id).eq("type", "voided");
    expect(ev).toHaveLength(1);

    // The final goes out through the ordinary Send.
    await finalCard.getByRole("button", { name: "Send", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Send final invoice" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: /^Send \$1,200\.10 invoice to Penderel/ }).click();
    await expect(sheet).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => (await invoicesOf(j)).find((i) => i.kind === "final")?.status, { timeout: 30_000 }).toMatch(/^(issued|sent)$/);
    invs = await invoicesOf(j);
    const fin = invs.find((i) => i.kind === "final")!;
    expect(fin.number).toBeTruthy();

    // The customer, anonymous: the cancelled deposit says so; the final asks for the whole job.
    const customer = await (await browser.newContext()).newPage();
    await customer.goto(`/i/${dep.token}`);
    await expect(customer.locator(".status-note.void")).toContainText("cancelled");
    await customer.goto(`/i/${fin.token}`);
    await expect(customer.locator(".invoice-view")).toContainText(money(120_010));
    await expect(customer.locator(".status-note.void")).toHaveCount(0);
    await customer.context().close();
  });

  test("money already paid on the deposit stops it — the ordinary final nets that off", async () => {
    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Paiddep", {
      contractCents: 200_000, stage: "closed", startDate: isoDay(-3),
      invoices: [{ kind: "deposit", status: "viewed", total: 100_000, due: isoDay(-5), paid: true }],
    });
    made.push(j);
    expect(await rpcAs(staff!, "invoice_final_in_full", { p_estimate_id: j.f.estimateId })).toBe("error:has_payments");
    const invs = await invoicesOf(j);
    expect(invs).toHaveLength(1);
    expect(invs[0].status).toBe("viewed");
  });

  test("nothing sent and unpaid to cancel — the ordinary Invoice in full is the path", async () => {
    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Nodep", {
      contractCents: 90_000, stage: "closed", startDate: isoDay(-3),
      invoices: [{ kind: "deposit", status: "draft", total: 45_000, due: null }],
    });
    made.push(j);
    expect(await rpcAs(staff!, "invoice_final_in_full", { p_estimate_id: j.f.estimateId })).toBe("error:nothing_to_cancel");
    expect(await invoicesOf(j)).toHaveLength(1);
  });
});
