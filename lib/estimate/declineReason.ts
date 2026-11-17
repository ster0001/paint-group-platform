/**
 * The decline reasons (E11, 17 Nov 2026). Client-safe. The customer's decline
 * panel offers "Went with another quote / Postponing / Price / Other"
 * (app/e/[token]/CustomerEstimate.tsx); E11's chips ask the same question of
 * a customer who declined without one, in the words Appendix A uses, and
 * store the panel's words so every reader sees one vocabulary. E12 reads
 * "Postponing" as the timing reason.
 */
export const DECLINE_REASON_CODES = {
  price: { chip: "Price", stored: "Price" },
  timing: { chip: "Timing", stored: "Postponing" },
  other_quote: { chip: "Went with someone else", stored: "Went with another quote" },
  not_going: { chip: "Not going ahead", stored: "Not going ahead" },
} as const;
export type DeclineReasonCode = keyof typeof DECLINE_REASON_CODES;
export const DECLINE_REASON_KEYS = Object.keys(DECLINE_REASON_CODES) as DeclineReasonCode[];

export const isDeclineReasonCode = (v: unknown): v is DeclineReasonCode => typeof v === "string" && v in DECLINE_REASON_CODES;
/** No reason given — what E11 asks about. */
export const declineReasonMissing = (reason: string | null | undefined): boolean => !reason || !reason.trim();
/** The timing reason — what E12 follows up, 60 days on. */
export const isTimingReason = (reason: string | null | undefined): boolean => (reason ?? "").trim().toLowerCase().startsWith("postponing");

/** E11's chips as lines of the chat message: "Price: <link>". */
export function reasonLinks(pageUrl: string): string {
  return DECLINE_REASON_KEYS.map((k) => `${DECLINE_REASON_CODES[k].chip}: ${pageUrl}?r=${k}`).join("\n");
}
