import { NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyStripeSignature } from "@/lib/invoicing/stripeSig";
import { fetchStripeFeeCents, stripeWebhookConfigured } from "@/lib/invoicing/stripe";
import { ensureReceiptPdf } from "@/lib/invoicing/pdf";
import { sendReceiptEmail } from "@/lib/invoicing/sendInvoice";
import { reportError } from "@/lib/monitoring/report";

/**
 * The Stripe webhook — THE sole writer of card-payment success (§5.3). The
 * redirect page only ever reads. Order of operations per §5.2: verify the
 * signature → insert into stripe_events (unique event_id; a duplicate
 * delivery exits 200 without processing) → dispatch → mark processed.
 * Fee capture, receipt PDF and receipt email ride behind the response.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeWebhookConfigured() || !secret) {
    return new NextResponse("Webhook not configured.", { status: 503 });
  }

  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret)) {
    return new NextResponse("Bad signature.", { status: 400 });
  }

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return new NextResponse("Bad payload.", { status: 400 });
  }
  if (!event.id || !event.type) return new NextResponse("Bad payload.", { status: 400 });

  const service = createServiceClient();
  if (!service) return new NextResponse("Service unavailable.", { status: 503 });

  // The idempotency door: 'done' deliveries are acknowledged untouched;
  // 'retry' (a previous dispatch died before finishing) processes again —
  // every handler below is itself idempotent, so that is always safe.
  const inserted = await service.rpc("stripe_event_insert", {
    p_event_id: event.id, p_type: event.type, p_payload: event,
  });
  if (inserted.error) {
    reportError(inserted.error, { where: "stripeWebhook.insert", extra: { eventId: event.id } });
    return new NextResponse("Storage failed.", { status: 500 });
  }
  if (inserted.data === "done") return NextResponse.json({ received: true, duplicate: true });

  const obj = event.data?.object ?? {};

  try {
    if (event.type === "checkout.session.completed") {
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      const invoiceId = meta.invoice_id;
      const invoiceCents = Number(meta.invoice_cents ?? 0);
      const surchargeCents = Number(meta.surcharge_cents ?? 0);
      const paymentIntent = String(obj.payment_intent ?? "");
      if (invoiceId && invoiceCents > 0 && paymentIntent) {
        const r = await service.rpc("record_stripe_payment", {
          p_invoice_id: invoiceId,
          p_payment_intent: paymentIntent,
          p_amount_cents: invoiceCents,
          p_surcharge_cents: surchargeCents,
        });
        const result = String(r.data ?? "");
        if (r.error || !result.startsWith("ok")) {
          throw new Error(r.error?.message ?? result);
        }
        // Fee, receipt PDF and receipt email — after the 200.
        after(async () => {
          const fee = await fetchStripeFeeCents(paymentIntent);
          if (fee != null) {
            await service.rpc("payment_set_stripe_fee", {
              p_payment_intent: paymentIntent, p_fee_cents: fee,
            });
          }
          const { data: pay } = await service
            .from("payments").select("id").eq("stripe_payment_intent_id", paymentIntent).maybeSingle();
          const paymentId = (pay as { id: string } | null)?.id;
          if (paymentId) {
            await ensureReceiptPdf(paymentId);
            await sendReceiptEmail(service, paymentId);
          }
        });
      }
    } else if (event.type === "charge.refunded") {
      const paymentIntent = String(obj.payment_intent ?? "");
      const refunded = Number(obj.amount_refunded ?? 0);
      if (paymentIntent) {
        const r = await service.rpc("record_stripe_refund", {
          p_payment_intent: paymentIntent, p_amount_cents: refunded,
        });
        if (r.error) throw new Error(r.error.message);
      }
    } else if (event.type === "payment_intent.payment_failed") {
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      const err = (obj.last_payment_error ?? {}) as { message?: string };
      if (meta.invoice_id) {
        await service.rpc("record_stripe_failure", {
          p_invoice_id: meta.invoice_id,
          p_payment_intent: String(obj.id ?? ""),
          p_reason: err.message ?? "",
        });
      }
    }
    // Every other event type: stored in stripe_events, nothing to do.

    await service.rpc("stripe_event_processed", { p_event_id: event.id });
    return NextResponse.json({ received: true });
  } catch (e) {
    // Not marked processed — Stripe retries, the idempotency layers absorb it.
    reportError(e, { where: "stripeWebhook.dispatch", extra: { eventId: event.id, type: event.type } });
    return new NextResponse("Processing failed.", { status: 500 });
  }
}
