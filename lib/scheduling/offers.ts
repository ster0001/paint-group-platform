// Booking-offer model shared by the staff app and the contractor portal.
// No Supabase imports — Client Components import this too.

export type OfferState =
  | "offered"
  | "proposed"
  | "accepted"
  | "declined"
  | "expired"
  | "withdrawn";

export type BookingOffer = {
  id: string;
  work_order_id: string;
  contractor_id: string;
  state: OfferState;
  start_date: string;
  end_date: string | null;
  hours_allowance: number | null;
  payment_cents: number | null;
  staff_note: string;
  offered_at: string;
  expires_at: string;
  responded_at: string | null;
  proposed_start_date: string | null;
  response_note: string;
  decline_reason: string;
};

export const OFFER_COLUMNS =
  "id, work_order_id, contractor_id, state, start_date, end_date, hours_allowance, payment_cents, staff_note, offered_at, expires_at, responded_at, proposed_start_date, response_note, decline_reason";

/** States where the job is spoken for and no new offer may be made. */
export const LIVE_STATES: OfferState[] = ["offered", "proposed"];

export const isLive = (s: OfferState) => LIVE_STATES.includes(s);

/**
 * The state as it actually stands right now.
 *
 * A lapsed offer stays 'offered' in the table until something sweeps it, so
 * every read goes through here — otherwise a contractor whose phone has been
 * asleep sees a live-looking offer with a countdown reading zero. The database
 * re-checks expiry too (respond_to_offer); this is the display half of the
 * same rule.
 */
export function effectiveState(offer: Pick<BookingOffer, "state" | "expires_at">): OfferState {
  if (isLive(offer.state) && new Date(offer.expires_at).getTime() < Date.now()) return "expired";
  return offer.state;
}

/** Chip styling vocabulary from the approved spec. */
export const OFFER_CHIP: Record<OfferState, { cls: string; label: string }> = {
  offered: { cls: "amb", label: "Awaiting your answer" },
  proposed: { cls: "amb", label: "New date proposed" },
  accepted: { cls: "grn", label: "Booked" },
  declined: { cls: "cly", label: "Declined" },
  expired: { cls: "cly", label: "Expired" },
  withdrawn: { cls: "gry", label: "Withdrawn" },
};

/** Staff-side wording for the same states. */
export const OFFER_CHIP_STAFF: Record<OfferState, string> = {
  offered: "Offered — awaiting response",
  proposed: "Contractor proposed a new date",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired — no response",
  withdrawn: "Withdrawn",
};

export const DECLINE_REASONS = [
  "On another job",
  "Too far to travel",
  "Scope not for me",
  "Price",
  "Other",
];

/** Offers run for 24 hours from when they're sent. */
export const OFFER_WINDOW_HOURS = 24;

export function expiryFromNow(hours = OFFER_WINDOW_HOURS): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/** Milliseconds left, floored at zero. */
export function msRemaining(expiresAt: string): number {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

/** "23:41:07" — the countdown format from the mockup. */
export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Suburb-only rendering of a job address, for offers the contractor hasn't
 * accepted yet. Addresses here are staff-typed free text of the shape
 * "12 Baker Street, Richmond VIC 3121", so take the last part that still looks
 * like a place name and drop anything with a street number in it.
 *
 * Deliberately conservative: when the shape isn't recognised it returns a
 * generic label rather than guessing and leaking the street.
 */
export function suburbOnly(address: string | null | undefined): string {
  const raw = (address ?? "").trim();
  if (!raw) return "Location on acceptance";
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return "Location on acceptance";

  // Walk from the end, skipping bare postcodes/states, and take the first part
  // that has no digits (a street line always carries a number).
  for (let i = parts.length - 1; i >= 1; i--) {
    const candidate = parts[i]
      .replace(/\b\d{4}\b/g, "") // postcode
      .replace(/\b(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b/gi, "") // state
      .trim();
    if (candidate && !/\d/.test(candidate)) return candidate;
  }
  return "Location on acceptance";
}
