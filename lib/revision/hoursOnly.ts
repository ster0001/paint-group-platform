/**
 * Tom, 12 Oct 2026 (73 Kerferd Rd): a Revise-scope change that moves the
 * CONTRACTOR's hours without moving the CUSTOMER's price — an imported,
 * price-overridden job — has nothing for the customer to sign. It goes to the
 * painter to approve (wo_apply_hours_only_change, 20270253).
 */
export function hoursOnlyChange(priceIncCents: number, hours: number): boolean {
  return priceIncCents === 0 && hours > 0;
}

/**
 * Whether a drafted change is a credit. The customer's delta decides; at the
 * same customer price, FEWER contractor hours is a credit to the painter (a
 * positive row would have paid them for hours taken away).
 */
export function revisionCredit(deltaIncCents: number, hoursDelta: number): boolean {
  return deltaIncCents < 0 || (deltaIncCents === 0 && hoursDelta < 0);
}
