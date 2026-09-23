/**
 * Approved changes to the scope, as the painter's job sheet lists them (Tom,
 * 23 Sep 2026: "contractors must be able to see all approved variations from
 * the revision working scope in their work order"). The work and the hours,
 * never the customer's price — one shape whether the rows came from the
 * contractor's own session (portal), the office's as-contractor view, or the
 * token link's RPC (`get_work_order_scope_changes_by_token`, 20270192).
 *
 * Also here: the customer's OFFER. Since 20270192 every pending revision draft
 * on a job shares one customer_token, so "what is waiting on the customer" is
 * one item per token, not one per row — the portal's attention list and
 * timeline group through `pendingOffers` rather than each drawing a card per
 * row and handing the customer five links to the same page.
 */

export type ScopeChange = {
  id: string;
  category: string;
  comment: string;
  estHours: number | null;
  /** A signed removal — shown as "Removed", never as work to do. */
  credit: boolean;
  status: string;
  approvedAt: string | null;
};

export type ScopeChangeRow = {
  id: string;
  category: string;
  comment: string;
  est_hours: number | string | null;
  credit?: boolean | null;
  status: string;
  customer_responded_at?: string | null;
  approved_at?: string | null;
  created_at?: string | null;
};

/** The two statuses that mean "the customer said yes". */
export const APPROVED_STATUSES: ReadonlySet<string> = new Set(["customer_approved", "contractor_accepted"]);

export function scopeChangesFrom(rows: readonly ScopeChangeRow[]): ScopeChange[] {
  return rows
    .filter((r) => APPROVED_STATUSES.has(r.status))
    .map((r) => ({
      id: r.id,
      category: r.category,
      comment: r.comment,
      estHours: r.est_hours == null ? null : Number(r.est_hours),
      credit: Boolean(r.credit),
      status: r.status,
      approvedAt: r.approved_at ?? r.customer_responded_at ?? r.created_at ?? null,
    }))
    .sort((a, b) => (a.approvedAt ?? "").localeCompare(b.approvedAt ?? ""));
}

export type OfferRow = {
  id: string;
  status: string;
  price_cents: number | null;
  credit?: boolean | null;
  customer_token: string | null;
  customer_responded_at: string | null;
};

export type PendingOffer<T extends OfferRow> = {
  token: string;
  rows: T[];
  count: number;
  /** Signed: additions add, credits subtract. What the customer is asked to sign for. */
  netCents: number;
};

/** Signed contribution of one row to the offer's total. */
export function offerRowCents(r: Pick<OfferRow, "price_cents" | "credit">): number {
  const cents = r.price_cents ?? 0;
  return r.credit ? -cents : cents;
}

/** Pending rows grouped by token, in first-seen order. Answered rows are out. */
export function pendingOffers<T extends OfferRow>(rows: readonly T[]): PendingOffer<T>[] {
  const byToken = new Map<string, T[]>();
  for (const r of rows) {
    if (r.status !== "priced" || !r.customer_token || r.customer_responded_at) continue;
    const list = byToken.get(r.customer_token) ?? [];
    list.push(r);
    byToken.set(r.customer_token, list);
  }
  return [...byToken].map(([token, list]) => ({
    token,
    rows: list,
    count: list.length,
    netCents: list.reduce((s, r) => s + offerRowCents(r), 0),
  }));
}

/** "a change" / "3 changes" — the offer, in the customer's words. */
export function offerNoun(count: number): string {
  return count === 1 ? "a change" : `${count} changes`;
}
