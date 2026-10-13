/**
 * What the revision builder says before a save that moves the contractor's
 * side (Tom, 12–13 Oct 2026), and after it. Pure wording over the engine's
 * figures — no arithmetic of its own beyond comparing them.
 *
 *   rate change  → never goes to the customer. Nobody on the job: the
 *                  contractor's price just follows. A painter on the job: the
 *                  new rate goes to them to accept (wo_sync_contractor_pay).
 *   hours change → goes to the customer to sign first (Save & draft), then
 *                  to the painter to approve.
 */
export type ContractorSide = { hours: number; offer: number; rate: number };

const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const perHour = (c: number) => money(c).replace(/\.00$/, "") + "/h";

export function revisionSaveWarnings(before: ContractorSide, now: ContractorSide): string[] {
  const out: string[] = [];
  if (before.rate !== now.rate) {
    out.push(
      `The contractor's hourly rate has changed: ${perHour(before.rate)} → ${perHour(now.rate)}.\n` +
      "This does not go to the customer. Saving updates it for the contractor: before anyone has accepted the job, " +
      `their price becomes ${money(now.offer)} (was ${money(before.offer)}); if a contractor has already accepted it, ` +
      "the new rate is sent to them to accept.",
    );
  }
  if (Math.abs(before.hours - now.hours) >= 0.01) {
    out.push(
      `Contractor hours have changed: ${before.hours.toFixed(1)} h → ${now.hours.toFixed(1)} h.\n` +
      "Hours go to the customer to sign first (Save & draft variations for signature), then to the contractor to approve.",
    );
  }
  return out;
}

/** The save message's note for each answer wo_sync_contractor_pay gives. */
export const PAY_NOTE: Record<string, string> = {
  "ok:synced": " · contractor's price updated",
  "ok:live": " · contractor already has this job, their price unchanged",
  "ok:pay_change_sent": " · new rate sent to the contractor to accept",
  "ok:pay_change_pending": " · new rate waiting on the contractor",
  "ok:pay_change_withdrawn": " · back to the agreed rate — the change sent to the contractor was withdrawn",
};
