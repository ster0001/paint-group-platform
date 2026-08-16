// Booking-offer model shared by the staff app and the contractor portal.
// No Supabase imports — Client Components import this too.

export type OfferState =
  | "offered"
  | "proposed"
  | "accepted"
  | "declined"
  | "expired"
  | "withdrawn"
  | "cancelled";

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
  accepted_at: string | null;
  cancelled_reason: string;
  cancelled_at: string | null;
  /** The date the job WAS booked for while a reschedule awaits staff. */
  prior_start_date: string | null;
  /** Staff's clock on a proposal — distinct from the contractor's expires_at. */
  approval_due_at: string | null;
};

export const OFFER_COLUMNS =
  "id, work_order_id, contractor_id, state, start_date, end_date, hours_allowance, payment_cents, staff_note, offered_at, expires_at, responded_at, proposed_start_date, response_note, decline_reason, accepted_at, cancelled_reason, cancelled_at, prior_start_date, approval_due_at";

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
  // Only an UNANSWERED offer lapses. A proposal is waiting on staff, and
  // expiring it silently would drop a job on the floor.
  if (offer.state === "offered" && new Date(offer.expires_at).getTime() < Date.now()) return "expired";
  return offer.state;
}

/** True when this proposal is a request to move an ALREADY-BOOKED job. */
export const isReschedule = (o: Pick<BookingOffer, "prior_start_date">) => Boolean(o.prior_start_date);

/** Chip styling vocabulary from the approved spec. */
export const OFFER_CHIP: Record<OfferState, { cls: string; label: string }> = {
  offered: { cls: "amb", label: "Awaiting your answer" },
  proposed: { cls: "amb", label: "New date proposed" },
  accepted: { cls: "grn", label: "Booked" },
  declined: { cls: "cly", label: "Declined" },
  expired: { cls: "cly", label: "Expired" },
  withdrawn: { cls: "gry", label: "Withdrawn" },
  cancelled: { cls: "cly", label: "Cancelled" },
};

/** Staff-side wording for the same states. */
export const OFFER_CHIP_STAFF: Record<OfferState, string> = {
  offered: "Offered — awaiting response",
  proposed: "Contractor proposed a new date",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired — no response",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
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

/**
 * dd-mm-yy — the format Tom asked for on date-change requests, and the one an
 * Australian tradesperson reads without pausing. Parsed as UTC so the day can't
 * shift; a raw ISO date is never shown to a user.
 */
export function formatDMY(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return String(date);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${String(d.getUTCFullYear()).slice(2)}`;
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
