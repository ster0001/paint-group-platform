import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { siteUrl } from "./pdf";
import { surchargeCents, surchargeFromSettings } from "./surcharge";

/**
 * SERVER ONLY — Stripe over plain REST (the Resend/Twilio pattern; no SDK,
 * no PCI surface, no publishable key). §5 shape: hosted Checkout, one
 * session per payment, webhook-driven truth.
 *
 * Keys are server env ONLY: STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET.
 * Nothing here runs without them — unconfigured means the customer page
 * simply offers bank transfer alone. Per Tom's C1 ruling, TEST keys live
 * only in the dedicated test project's env, never here.
 */

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripeWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

async function stripePost(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const err = (body?.error as { message?: string } | undefined)?.message ?? `Stripe returned ${res.status}`;
    throw new Error(err);
  }
  return body ?? {};
}

async function stripeGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const err = (body?.error as { message?: string } | undefined)?.message ?? `Stripe returned ${res.status}`;
    throw new Error(err);
  }
  return body ?? {};
}

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; reason: "not_configured" | "not_payable" | "error"; message?: string };

/**
 * A FRESH Checkout Session at click time (§5.1 — sessions expire; the link
 * must not). Line 1 is the invoice's exact current balance, server-computed
 * this instant; line 2 is the disclosed ⚑4 surcharge. The browser
 * contributes nothing but the click.
 */
export async function createCheckoutSession(invoiceToken: string): Promise<CheckoutResult> {
  if (!stripeConfigured()) return { ok: false, reason: "not_configured" };
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "error", message: "service unavailable" };

  const { data } = await service
    .from("invoices")
    .select("id, estimate_id, number, status, total_inc_cents, token")
    .eq("token", invoiceToken)
    .maybeSingle();
  const inv = data as {
    id: string; estimate_id: string; number: string | null; status: string;
    total_inc_cents: number; token: string;
  } | null;
  if (!inv || !["issued", "sent", "viewed", "partially_paid"].includes(inv.status)) {
    return { ok: false, reason: "not_payable" };
  }

  const [{ data: pays }, { data: setting }] = await Promise.all([
    service.from("payments").select("amount_cents").eq("invoice_id", inv.id).eq("status", "succeeded"),
    service.from("settings").select("value").eq("key", "invoicing").maybeSingle(),
  ]);
  const paid = ((pays ?? []) as { amount_cents: number }[]).reduce((a, p) => a + p.amount_cents, 0);
  const balance = inv.total_inc_cents - paid;
  if (balance <= 0) return { ok: false, reason: "not_payable" };

  const { pctBps, fixedCents } = surchargeFromSettings(setting?.value as Record<string, unknown> | null);
  const surcharge = surchargeCents(balance, pctBps, fixedCents);

  try {
    const form: Record<string, string> = {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "aud",
      "line_items[0][price_data][unit_amount]": String(balance),
      "line_items[0][price_data][product_data][name]": `Invoice ${inv.number} — Paint Group`,
      "metadata[invoice_id]": inv.id,
      "metadata[estimate_id]": inv.estimate_id,
      "metadata[invoice_cents]": String(balance),
      "metadata[surcharge_cents]": String(surcharge),
      "payment_intent_data[description]": `Invoice ${inv.number} — Paint Group`,
      "payment_intent_data[metadata][invoice_id]": inv.id,
      success_url: `${siteUrl()}/i/${inv.token}?pay=success`,
      cancel_url: `${siteUrl()}/i/${inv.token}?pay=cancelled`,
    };
    if (surcharge > 0) {
      form["line_items[1][quantity]"] = "1";
      form["line_items[1][price_data][currency]"] = "aud";
      form["line_items[1][price_data][unit_amount]"] = String(surcharge);
      form["line_items[1][price_data][product_data][name]"] =
        "Card payment surcharge — avoid this by paying via bank transfer";
    }
    const session = await stripePost("checkout/sessions", form);

    // The session id on the activity feed — the redirect page never needs it.
    await service.from("invoice_events").insert({
      invoice_id: inv.id, type: "checkout_created", actor_kind: "customer",
      meta: { session_id: session.id, balance_cents: balance, surcharge_cents: surcharge },
    });

    const url = session.url as string | undefined;
    if (!url) return { ok: false, reason: "error", message: "no session url" };
    return { ok: true, url };
  } catch (e) {
    reportError(e, { where: "createCheckoutSession", extra: { invoiceToken } });
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : "checkout failed" };
  }
}

/** The Stripe processing fee for a completed payment intent (best-effort). */
export async function fetchStripeFeeCents(paymentIntentId: string): Promise<number | null> {
  if (!stripeConfigured()) return null;
  try {
    const pi = await stripeGet(
      `payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge.balance_transaction`,
    );
    const charge = pi.latest_charge as { balance_transaction?: { fee?: number } } | undefined;
    const fee = charge?.balance_transaction?.fee;
    return typeof fee === "number" ? fee : null;
  } catch (e) {
    reportError(e, { where: "fetchStripeFeeCents", bestEffort: true, extra: { paymentIntentId } });
    return null;
  }
}
