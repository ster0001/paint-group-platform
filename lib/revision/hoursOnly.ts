/**
 * Whether a drafted change is a credit. The customer's delta decides; at the
 * same customer price, FEWER contractor hours is a credit to the painter (a
 * positive row would have paid them for hours taken away).
 */
export function revisionCredit(deltaIncCents: number, hoursDelta: number): boolean {
  return deltaIncCents < 0 || (deltaIncCents === 0 && hoursDelta < 0);
}
