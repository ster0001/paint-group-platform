import type { SequenceStep } from "./leadSequence";

/**
 * The estimate sequence, E2–E7 (automations brief §4.3, master plan Appendix
 * A; 17 Nov 2026). PURE — the steps; `sequenceStepsDue` (leadSequence.ts)
 * says which are due from the estimate's derived stage and how long it has
 * been there. The stage engine (lib/crm/estimateStage.ts) is the exit: a
 * question, an acceptance, a decline or a revision moves the estimate out of
 * the step's stage and nothing more of that stage is due.
 *
 *   E2  estimate_unopened        text  2 days after sending, not opened    estimate_sent
 *   E3  estimate_unopened_again  chat  5 days after sending, not opened    estimate_sent
 *   E4  estimate_viewed_any_q    chat  2 days after first opened, quiet    estimate_viewed
 *   E5  estimate_viewed_worth    chat  5 days after                        estimate_viewed
 *   E7  estimate_viewed_held     chat  14 days after — no incentive (R9)   estimate_viewed
 *
 * E3's call and E6 (call at 7 days, record the reason) are the existing
 * Follow up card on Today (lib/crm/work-queue.ts buildQuietQuoteItems), timed
 * by Settings → CRM's chase days — one card for "chase this quote", never two.
 */
export type EstimateStepKey = "estimate_unopened" | "estimate_unopened_again" | "estimate_viewed_any_q" | "estimate_viewed_worth" | "estimate_viewed_held";
export type EstimateStage = "estimate_sent" | "estimate_viewed";
export type EstimateStep = SequenceStep<EstimateStepKey, EstimateStage>;

const DAY = 24 * 3_600_000;
export const ESTIMATE_STEPS: readonly EstimateStep[] = [
  { key: "estimate_unopened", stage: "estimate_sent", channel: "sms", unit: "days", defaultAfter: 2, lateMs: DAY },
  { key: "estimate_unopened_again", stage: "estimate_sent", channel: "chat", unit: "days", defaultAfter: 5, lateMs: DAY },
  { key: "estimate_viewed_any_q", stage: "estimate_viewed", channel: "chat", unit: "days", defaultAfter: 2, lateMs: DAY },
  { key: "estimate_viewed_worth", stage: "estimate_viewed", channel: "chat", unit: "days", defaultAfter: 5, lateMs: DAY },
  { key: "estimate_viewed_held", stage: "estimate_viewed", channel: "chat", unit: "days", defaultAfter: 14, lateMs: DAY },
];

const EXPIRY = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short" });
/** "Fri 2 Oct" — an estimate's valid-until day as Appendix A writes {expiry}. */
export function expiryWords(validUntil: string | null): string {
  if (!validUntil) return "the date on your quote";
  return EXPIRY.format(new Date(`${validUntil}T12:00:00Z`)).replace(",", "");
}
