import { createHmac } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcAs, serviceClient } from "./fixtures/woLoop";
import { credentials } from "./helpers";

/**
 * The §8 Step 4 money e2e — REAL Stripe test-mode, C1 TEST PROJECT ONLY.
 *
 *   pay in full with a test card → webhook-confirmed
 *   duplicate webhook delivery processes once
 *   abandoned session is inert (no DB writes ever happened)
 *   refund flips the payment, never the invoice
 *
 * Runs only under scripts/c1/run-e2e.sh (E2E_C1=1 + Stripe TEST keys from
 * .env.test.local). Webhook deliveries are SELF-SIGNED with the configured
 * STRIPE_WEBHOOK_SECRET and posted to our endpoint — the full signature +
 * idempotency + RPC pipeline is exercised without needing a public URL or
 * the Stripe CLI. (`stripe listen --forward-to localhost:3101/api/webhooks/stripe`
 * works too, for manual poking.)
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const SK = process.env.STRIPE_SECRET_KEY ?? "";
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET ?? "";

const ADDRESS = `9 Stripe Test Pde, Melbourne ${process.pid}`;
const TOTAL = 1_850_000; // $18,500 inc GST
const DEPOSIT = 185_000; // 10%
const SURCHARGE = Math.round(DEPOSIT * 0.017) + 30; // ⚑4 defaults: 3175

let estimateId: string | null = null;
let depositId: string | null = null;
let depositToken: string | null = null;
let sessionEvent: Record<string, unknown> | null = null;
let paymentIntent: string | null = null;

test.describe.configure({ mode: "serial" });

function signEvent(payload: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", WHSEC).update(`${t}.${payload}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

async function stripeGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${SK}` },
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(JSON.stringify(body.error ?? body));
  return body;
}

async function deliverWebhook(page: Page, event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  return page.request.post("/api/webhooks/stripe", {
    data: payload,
    headers: { "content-type": "application/json", "stripe-signature": signEvent(payload) },
  });
}

test.describe("Stripe test-card flow — C1 only", () => {
  test.skip(process.env.E2E_C1 !== "1", "run through scripts/c1/run-e2e.sh (test stack only)");
  test.skip(!db, "test-project service key missing");
  test.skip(!staff, "E2E staff credentials missing");
  test.skip(!SK.startsWith("sk_test_"), "STRIPE_SECRET_KEY must be a TEST key (sk_test_…)");
  test.skip(!WHSEC, "STRIPE_WEBHOOK_SECRET missing (any whsec_ value you choose for the test env)");

  test.beforeAll(async () => {
    const sb = db!;
    const token = `c1stripe${Math.abs(Date.now() % 1e10)}${process.pid}`;
    const { data: est, error } = await sb.from("estimates").insert({
      title: "C1 Stripe e2e", status: "sent", level_of_finish: 3, share_token: token,
      total_cents: TOTAL, builder_state: { blocks: [] },
      sent_snapshot: {
        totals: { totalCents: TOTAL }, depositPct: 10, gstRatePct: 10,
        jobAddress: ADDRESS, jobTitle: "Exterior repaint", baseSubtotalCents: 1_681_818,
        areas: [{ id: "a1", title: "Whole exterior", descriptionHtml: "Two coats", priceCents: 1_681_818 }],
        lineItems: [], options: [],
      },
    }).select("id").single();
    if (error) throw new Error(error.message);
    estimateId = (est as { id: string }).id;

    const acc = await sb.rpc("accept_estimate", {
      p_token: token, p_name: "C1 Stripe Customer", p_options: [], p_total_cents: 0, p_deposit_cents: 0,
    });
    expect(acc.data).toBe("accepted");

    const { data: dep } = await sb.from("invoices")
      .select("id, token").eq("estimate_id", estimateId).single();
    depositId = (dep as { id: string }).id;
    depositToken = (dep as { token: string }).token;

    const issued = await rpcAs(staff!, "invoice_issue", { p_invoice_id: depositId });
    expect(String(issued)).toContain("ok");
  });

  test.afterAll(async () => {
    if (!db || !estimateId) return;
    const { data: invRows } = await db.from("invoices").select("id").eq("estimate_id", estimateId);
    for (const r of (invRows ?? []) as { id: string }[]) {
      const { data: files } = await db.storage.from("invoice-docs").list(r.id);
      if (files?.length) await db.storage.from("invoice-docs").remove(files.map((f) => `${r.id}/${f.name}`));
    }
    await db.from("invoices").delete().eq("estimate_id", estimateId);
    await db.from("work_orders").delete().eq("estimate_id", estimateId);
    await db.from("follow_ups").delete().eq("estimate_id", estimateId);
    await db.from("estimate_events").delete().eq("estimate_id", estimateId);
    await db.from("estimates").delete().eq("id", estimateId);
  });

  test("pay in full with a test card — confirmed only by the webhook", async ({ page }) => {
    test.setTimeout(240_000);

    // The customer's page offers the card path with the disclosed surcharge.
    await page.goto(`/i/${depositToken}`);
    await expect(page.getByTestId("pay-panel")).toBeVisible();
    await expect(page.getByTestId("pay-panel")).toContainText("surcharge");

    // Click through to Stripe's hosted page and pay with the 4242 test card.
    await page.getByRole("button", { name: /Pay .* by card/ }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
    await page.locator("#email").fill("c1-test@example.com");
    // The card fields only render once "Card" is picked from the payment
    // methods — a custom control, so try each plausible handle until the
    // card-number field actually exists. Then Link's "save my information"
    // goes off, or it demands a phone number.
    const cardPicks = [
      page.locator('input[type="radio"][value="card"]'),
      page.getByRole("radio", { name: /card/i }),
      page.locator('[data-testid*="card"][role="button"], [data-testid="card-accordion-item"]'),
      page.getByText("Card", { exact: true }),
    ];
    for (const pick of cardPicks) {
      if ((await pick.count()) === 0) continue;
      await pick.first().click({ force: true }).catch(() => {});
      const visible = await page.locator("#cardNumber").isVisible().catch(() => false);
      if (visible) break;
      await page.waitForTimeout(1_500);
      if (await page.locator("#cardNumber").isVisible().catch(() => false)) break;
    }
    await expect(page.locator("#cardNumber")).toBeVisible({ timeout: 20_000 });
    const saveInfo = page.locator('input[type="checkbox"]:checked');
    if (await saveInfo.count()) await saveInfo.first().uncheck({ force: true }).catch(() => {});
    await page.locator("#cardNumber").fill("4242 4242 4242 4242");
    await page.locator("#cardExpiry").fill("12 / 34");
    await page.locator("#cardCvc").fill("123");
    await page.locator("#billingName").fill("C1 Stripe Customer");
    const postal = page.locator("#billingPostalCode");
    if (await postal.count()) await postal.fill("3000");
    await page.locator('button[type="submit"]').click();

    // Back on our page: confirming, never claiming (§5.3).
    await page.waitForURL(/pay=success/, { timeout: 120_000 });
    await expect(page.getByTestId("pay-confirming")).toBeVisible();

    // No payment exists yet — the redirect wrote nothing.
    const { count: before } = await db!.from("payments")
      .select("id", { count: "exact", head: true }).eq("invoice_id", depositId!);
    expect(before).toBe(0);

    // The webhook delivery (self-signed, same pipeline end to end).
    const { data: ev } = await db!.from("invoice_events")
      .select("meta").eq("invoice_id", depositId!).eq("type", "checkout_created")
      .order("created_at", { ascending: false }).limit(1).single();
    const sessionId = (ev as { meta: { session_id: string } }).meta.session_id;

    let session: Record<string, unknown> | null = null;
    await expect.poll(async () => {
      session = await stripeGet(`checkout/sessions/${sessionId}`);
      return session.payment_status;
    }, { timeout: 60_000, intervals: [2_000] }).toBe("paid");

    sessionEvent = {
      id: `evt_c1_${Date.now()}`,
      type: "checkout.session.completed",
      data: { object: session },
    };
    paymentIntent = String((session as unknown as { payment_intent: string }).payment_intent);

    const res = await deliverWebhook(page, sessionEvent);
    expect(res.ok()).toBeTruthy();

    // NOW the database backs it: payment row, surcharge split, invoice paid.
    const { data: pay } = await db!.from("payments")
      .select("amount_cents, surcharge_cents, method, status, receipt_number")
      .eq("invoice_id", depositId!).single();
    expect(pay).toMatchObject({
      amount_cents: DEPOSIT, surcharge_cents: SURCHARGE,
      method: "stripe_card", status: "succeeded",
    });
    expect((pay as { receipt_number: string }).receipt_number).toMatch(/^RCT-\d{4}$/);
    const { data: inv } = await db!.from("invoices").select("status").eq("id", depositId!).single();
    expect((inv as { status: string }).status).toBe("paid");

    // And the customer's poller flips to confirmed on its own.
    await expect(page.getByTestId("pay-confirmed")).toBeVisible({ timeout: 20_000 });
  });

  test("a duplicate webhook delivery processes once", async ({ page }) => {
    const res = await deliverWebhook(page, sessionEvent!);
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toMatchObject({ duplicate: true });

    // Different event id, same payment intent — the RPC absorbs it too.
    const res2 = await deliverWebhook(page, { ...sessionEvent!, id: `evt_c1_replay_${Date.now()}` });
    expect(res2.ok()).toBeTruthy();

    const { count } = await db!.from("payments")
      .select("id", { count: "exact", head: true }).eq("invoice_id", depositId!);
    expect(count).toBe(1);
  });

  test("the Stripe processing fee lands behind the response", async () => {
    await expect.poll(async () => {
      const { data } = await db!.from("payments")
        .select("stripe_fee_cents").eq("invoice_id", depositId!).single();
      return (data as { stripe_fee_cents: number | null }).stripe_fee_cents;
    }, { timeout: 45_000, intervals: [3_000] }).toBeGreaterThan(0);
  });

  test("an abandoned checkout session is inert — no DB writes ever happened", async ({ page }) => {
    // Draft + issue a progress claim, open a session, never pay it.
    const drafted = await rpcAs(staff!, "invoice_request_payment", {
      p_estimate_id: estimateId!, p_mode: "percent", p_value: 25,
    });
    expect(String(drafted)).toContain("ok:");
    const progressId = String(drafted).slice(3);
    const issued = await rpcAs(staff!, "invoice_issue", { p_invoice_id: progressId });
    expect(String(issued)).toContain("ok");
    const { data: prog } = await db!.from("invoices").select("token, status").eq("id", progressId).single();

    const checkout = await page.request.post(`/i/${(prog as { token: string }).token}/checkout`, { maxRedirects: 0 });
    expect(checkout.status()).toBe(303); // a session was created…

    // …and abandoning it changes NOTHING.
    const { count } = await db!.from("payments")
      .select("id", { count: "exact", head: true }).eq("invoice_id", progressId);
    expect(count).toBe(0);
    const { data: after } = await db!.from("invoices").select("status").eq("id", progressId).single();
    expect((after as { status: string }).status).toBe("issued");
  });

  test("a refund flips the payment and never silently un-pays the invoice", async ({ page }) => {
    const refund = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: { Authorization: `Bearer ${SK}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ payment_intent: paymentIntent! }).toString(),
    });
    expect(refund.ok).toBeTruthy();

    let charge: Record<string, unknown> | null = null;
    await expect.poll(async () => {
      const list = await stripeGet(`charges?payment_intent=${encodeURIComponent(paymentIntent!)}`);
      charge = (list.data as Record<string, unknown>[])[0] ?? null;
      return charge ? Number(charge.amount_refunded) : 0;
    }, { timeout: 60_000, intervals: [2_000] }).toBeGreaterThan(0);

    const res = await deliverWebhook(page, {
      id: `evt_c1_refund_${Date.now()}`, type: "charge.refunded", data: { object: charge },
    });
    expect(res.ok()).toBeTruthy();

    const { data: pay } = await db!.from("payments")
      .select("status").eq("stripe_payment_intent_id", paymentIntent!).single();
    expect((pay as { status: string }).status).toBe("refunded");

    // The invoice is NOT un-paid — that decision belongs to a person.
    const { data: inv } = await db!.from("invoices").select("status").eq("id", depositId!).single();
    expect((inv as { status: string }).status).toBe("paid");

    const { data: events } = await db!.from("invoice_events")
      .select("type, meta").eq("invoice_id", depositId!).eq("type", "payment_refunded");
    expect((events ?? []).length).toBe(1);
    expect(((events![0] as { meta: { needs_credit_note: boolean } }).meta.needs_credit_note)).toBe(true);
  });

  test("bad signatures never get in", async ({ page }) => {
    const payload = JSON.stringify({ id: "evt_forged", type: "checkout.session.completed", data: { object: {} } });
    const res = await page.request.post("/api/webhooks/stripe", {
      data: payload,
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    });
    expect(res.status()).toBe(400);
  });
});
