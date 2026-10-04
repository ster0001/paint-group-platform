/**
 * Card payments ON/OFF — the Settings switch (Tom, 4 Oct 2026).
 *
 * `invoicing.cardPaymentsEnabled` in the `invoicing` settings key. OFF by
 * default: a customer sees bank transfer only, the checkout route refuses,
 * and no Checkout Session is ever minted. ON only takes effect when the
 * server also holds STRIPE_SECRET_KEY — the switch is the office's choice,
 * the key is the deployment's; both have to agree before a card button
 * shows. The webhook is deliberately NOT gated: a payment or refund already
 * in flight at Stripe must still land in the ledger after the switch is
 * turned off.
 */

export function cardPaymentsEnabledFromSettings(value: Record<string, unknown> | null | undefined): boolean {
  return value?.cardPaymentsEnabled === true;
}
