import { NextResponse } from "next/server";
import { createCheckoutSession, stripeConfigured } from "@/lib/invoicing/stripe";

export const dynamic = "force-dynamic";

/**
 * The customer's "Pay now" — a FRESH Checkout Session at click time (§5.1):
 * the emailed link never expires because the session is minted here, per
 * click, against the invoice's exact current balance. The browser sends
 * nothing but the token in the URL.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!stripeConfigured()) {
    return new NextResponse("Card payments aren't available just now — the bank transfer details are on your invoice.", { status: 503 });
  }
  const result = await createCheckoutSession(token);
  if (!result.ok) {
    if (result.reason === "not_payable") {
      return new NextResponse("This invoice isn't open for payment.", { status: 409 });
    }
    return new NextResponse("Card payments aren't available just now — the bank transfer details are on your invoice.", { status: 503 });
  }
  return NextResponse.redirect(result.url, 303);
}
