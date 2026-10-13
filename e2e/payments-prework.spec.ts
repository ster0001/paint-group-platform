import { expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { accessTokenFor, contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Payments merge prework (12 Oct 2026), before Step 1 of
 * docs/briefs/claude-code-brief-payments-merge.md.
 *
 *  1. Nobody outside the office drafts a deposit or stamps a PDF path on a
 *     contractor invoice. The 20270201 hardening had re-granted EXECUTE on
 *     `invoice_draft_deposit` and the two attach-PDF helpers to every signed-in
 *     user — an anonymous wizard visitor included. Asked AS that visitor.
 *  2. Pause / Resume reminders works. It used to update `invoices` straight
 *     from the staff session, which has no UPDATE on invoices, so every press
 *     failed. Driven through the real buttons.
 *  3. The deep links land where they say: `?tab=` on the job view, the
 *     Payables tab, and the old contractor-invoice email link (it 404'd).
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const NOBODY = "00000000-0000-4000-8000-000000000000";

// invoice_draft_deposit is staff-callable again since Payments Step 3 (20270256,
// Create deposit): a non-staff caller is refused by its guard, error:not_staff.
const LOCKED: Array<[string, Record<string, unknown>]> = [
  ["invoice_draft_deposit", { p_estimate_id: NOBODY, p_auto: "import" }],
  ["contractor_invoice_attach_pdf", { p_id: NOBODY, p_path: "x.pdf" }],
  ["contractor_invoice_attach_remittance_pdf", { p_id: NOBODY, p_path: "x.pdf" }],
];

test.describe("definer functions the office owns", () => {
  test("an anonymous customer cannot call them", async () => {
    const visitor = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signInError } = await visitor.auth.signInAnonymously();
    expect(signInError, "anonymous sign-in").toBeNull();
    for (const [fn, args] of LOCKED) {
      const { data, error } = await visitor.rpc(fn, args);
      expect(error?.code === "42501" || data === "error:not_staff", `${fn} answered ${JSON.stringify(data ?? error)} to an anonymous visitor`).toBe(true);
    }
  });

  test("a contractor cannot call them", async () => {
    test.skip(!contractor, missingCreds("CONTRACTOR"));
    const token = await accessTokenFor(contractor!);
    for (const [fn, args] of LOCKED) {
      const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const body = (await res.json()) as { code?: string } | string;
      expect(["42501", "error:not_staff"], `${fn} for a contractor`).toContain(typeof body === "object" ? body.code : body);
    }
  });
});

test.describe("Pause / Resume reminders and the money deep links", () => {
  test.setTimeout(120_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  let f: LoopFixture | null = null;
  let invoiceId = "";
  const stamp = Date.now().toString(36);

  test.beforeAll(async () => {
    const cid = await contractorIdForEmail(db!, contractor!.email);
    f = await createLoopFixture(db!, cid!, [{ heading: "Living", labels: ["Walls"] }]);
    const { data, error } = await db!.from("invoices").insert({
      estimate_id: f.estimateId, work_order_id: f.workOrderId, kind: "progress", status: "sent", number: `INV-PW${stamp.slice(-5)}`,
      subtotal_ex_cents: 100_000, gst_cents: 10_000, total_inc_cents: 110_000, amount_cents: 110_000,
      issued_on: "2026-10-01", due_on: "2026-10-08",
      token: `e2e-pw-${stamp}-${Math.random().toString(36).slice(2, 14)}`,
    }).select("id").single();
    if (error) throw error;
    invoiceId = data!.id as string;
  });

  test.afterAll(async () => {
    if (!db || process.env.E2E_KEEP) return;
    if (invoiceId) {
      await db.from("invoice_events").delete().eq("invoice_id", invoiceId);
      await db.from("invoices").delete().eq("id", invoiceId);
    }
    await destroyLoopFixture(db, f);
  });

  test("staff pause with a reason and resume, from the invoice's card on the job panel", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);

    // Payments merge Step 7: Money in lists every invoice with its buttons.
    await page.goto(`/invoicing/job/${f!.estimateId}`);
    const pause = page.getByTestId("pause-reminders");
    await expect(pause).toBeVisible({ timeout: 30_000 });

    page.once("dialog", (d) => void d.accept("Payment plan agreed"));
    await pause.click();
    await expect(page.getByTestId("resume-reminders")).toBeVisible({ timeout: 20_000 });
    const held = await db!.from("invoices").select("chase_hold_reason, chase_hold_kind").eq("id", invoiceId).single();
    expect(held.error).toBeNull();
    expect(held.data).toEqual({ chase_hold_reason: "Payment plan agreed", chase_hold_kind: "office" });

    await page.getByTestId("resume-reminders").click();
    await expect(page.getByTestId("pause-reminders")).toBeVisible({ timeout: 20_000 });
    const running = await db!.from("invoices").select("chase_hold_reason, chase_hold_kind").eq("id", invoiceId).single();
    expect(running.data).toEqual({ chase_hold_reason: null, chase_hold_kind: null });

    const events = await db!.from("invoice_events").select("type").eq("invoice_id", invoiceId).order("created_at");
    expect((events.data ?? []).map((e) => e.type)).toEqual(["reminders_paused", "reminders_resumed"]);
  });

  test("the links into Payments land on the right tab", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);

    // A link written before the panel (?tab=costs) opens Money out and profit.
    await page.goto(`/invoicing/job/${f!.estimateId}?tab=costs`);
    await expect(page.getByRole("link", { name: "Money out and profit", exact: true })).toHaveClass(/\bon\b/, { timeout: 30_000 });

    await page.goto("/invoicing?tab=pay");
    await expect(page.getByRole("button", { name: "Payables", exact: true })).toHaveClass(/\bon\b/, { timeout: 30_000 });

    // Every "contractor invoice in" email before 12 Oct linked /invoicing/ci/<id>, which never existed.
    await page.goto(`/invoicing/ci/${NOBODY}`);
    await expect(page).toHaveURL(/\/invoicing\?tab=pay$/, { timeout: 30_000 });
  });
});
