import { createClient } from "@/lib/supabase/server";
import { OFFER_COLUMNS, effectiveState, isLive, type BookingOffer } from "./offers";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";

// Server-side assembly of the scheduling board. Staff-only — RLS on every table
// already restricts it, but this module is never imported by portal pages.

export type Lane = {
  contractorId: string;
  name: string;
  company: string;
  tier: string;
  offerable: boolean;
  active: boolean;
  /** Painters they can field at once — what makes overlapping jobs readable. */
  crewSize: number;
};

export type BlockKind = "accepted" | "in_progress" | "offered" | "proposed" | "unavailable";

export type Block = {
  id: string;
  kind: BlockKind;
  contractorId: string;
  /** Inclusive ISO dates. */
  start: string;
  end: string;
  title: string;
  woRef: string;
  workOrderId: string | null;
  offerId: string | null;
  paymentCents: number | null;
  finishCode: string | null;
  /** Offers only — when the 24h clock runs out. */
  expiresAt: string | null;
  /** Unavailability only — who blocked it out. */
  source: "contractor" | "staff" | null;
  reason: string;
};

/** An issued job with no live or accepted booking — the drag tray. */
export type TrayJob = {
  workOrderId: string;
  woRef: string;
  title: string;
  suburb: string;
  paymentCents: number | null;
  finishCode: string | null;
  estimatedDays: number;
  hours: number | null;
  /** Set when a previous contractor declined — worth flagging to staff. */
  lastDeclineReason: string;
};

/** A proposal or reschedule sitting with staff for a decision. */
export type Approval = {
  offer: BookingOffer;
  woRef: string;
  title: string;
  contractorName: string;
};

export type BoardData = {
  lanes: Lane[];
  blocks: Block[];
  tray: TrayJob[];
  approvals: Approval[];
  /** Query failures, surfaced rather than silently rendering an empty board. */
  errors: string[];
};

// Plain calendar dates, so the arithmetic stays in UTC end to end. Parsing as
// local midnight and formatting via toISOString() shifts the result a day for
// anyone east of Greenwich — which would put a job on the wrong date.
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** A job's duration in days, from its hours allowance. 8h days, minimum one. */
export function daysFromHours(hours: number | null | undefined): number {
  if (!hours || hours <= 0) return 1;
  return Math.max(1, Math.ceil(hours / 8));
}

function snapshotOf(v: unknown): WorkOrderDoc | null {
  const s = v as WorkOrderDoc | null;
  return s && (s as Partial<WorkOrderDoc>).version === 1 ? s : null;
}

export async function loadBoard(from: string, to: string): Promise<BoardData> {
  const supabase = await createClient();

  // Sweep lapsed offers so the board never shows a dead one as live.
  await supabase.rpc("expire_booking_offers").then(() => {}, () => {});

  const [
    { data: contractors, error: cErr },
    { data: workOrders, error: wErr },
    { data: offers, error: oErr },
    { data: unavail, error: uErr },
  ] = await Promise.all([
      supabase
        .from("contractors")
        .select("id, tier, active, offerable, company_name, crew_size, profiles ( name )")
        .order("company_name"),
      supabase
        .from("work_orders")
        .select("id, wo_ref, status, contractor_id, start_date, contractor_payment_cents, wo_snapshot, issued_at")
        .not("issued_at", "is", null),
      supabase.from("booking_offers").select(OFFER_COLUMNS),
      supabase
        .from("contractor_unavailability")
        .select("id, contractor_id, start_date, end_date, reason, source")
        .lte("start_date", to)
        .gte("end_date", from),
    ]);

  // An empty board because a query failed looks exactly like an empty board
  // because there is no work — so say which it is.
  const errors = [
    cErr && `contractors: ${cErr.message}`,
    wErr && `work orders: ${wErr.message}`,
    oErr && `offers: ${oErr.message}`,
    uErr && `unavailability: ${uErr.message}`,
  ].filter(Boolean) as string[];

  type CRow = { id: string; tier: string | null; active: boolean; offerable: boolean; company_name: string | null; crew_size: number | null; profiles: { name: string | null } | null };
  const lanes: Lane[] = ((contractors as CRow[] | null) ?? []).map((c) => ({
    contractorId: c.id,
    name: c.profiles?.name || c.company_name || "Contractor",
    company: c.company_name || "",
    tier: c.tier || "—",
    offerable: c.offerable,
    active: c.active,
    crewSize: c.crew_size ?? 1,
  }));

  type WRow = {
    id: string; wo_ref: string; status: string; contractor_id: string | null;
    start_date: string | null; contractor_payment_cents: number | null; wo_snapshot: unknown;
  };
  const wos = (workOrders as WRow[] | null) ?? [];
  const woById = new Map(wos.map((w) => [w.id, w]));

  const allOffers = (offers as BookingOffer[] | null) ?? [];
  const blocks: Block[] = [];

  // --- offers (live ones only; settled offers are history, not board state) ---
  for (const o of allOffers) {
    const state = effectiveState(o);
    if (!isLive(state)) continue;
    const w = woById.get(o.work_order_id);
    const doc = snapshotOf(w?.wo_snapshot);
    const start = state === "proposed" && o.proposed_start_date ? o.proposed_start_date : o.start_date;
    const span = o.end_date && o.end_date >= start
      ? o.end_date
      : addDays(start, daysFromHours(o.hours_allowance) - 1);
    blocks.push({
      id: `offer-${o.id}`,
      kind: state === "proposed" ? "proposed" : "offered",
      contractorId: o.contractor_id,
      start,
      end: span,
      title: doc?.jobTitle || w?.wo_ref || "Job",
      woRef: w?.wo_ref ?? "",
      workOrderId: o.work_order_id,
      offerId: o.id,
      paymentCents: o.payment_cents,
      finishCode: doc?.finishCode ?? null,
      expiresAt: o.expires_at,
      source: null,
      reason: "",
    });
  }

  // --- booked work: an accepted offer pins the job to a contractor and dates ---
  const acceptedByWo = new Map<string, BookingOffer>();
  for (const o of allOffers) if (o.state === "accepted") acceptedByWo.set(o.work_order_id, o);

  for (const w of wos) {
    const acc = acceptedByWo.get(w.id);
    // Also covers jobs staff assigned directly and dated without an offer.
    const hasDirect = !acc && w.contractor_id && w.start_date;
    if (!acc && !hasDirect) continue;
    const contractorId = acc?.contractor_id ?? w.contractor_id!;
    const start = acc?.start_date ?? w.start_date!;
    const doc = snapshotOf(w.wo_snapshot);
    const end = acc?.end_date && acc.end_date >= start
      ? acc.end_date
      : addDays(start, daysFromHours(acc?.hours_allowance ?? null) - 1);
    blocks.push({
      id: `wo-${w.id}`,
      kind: w.status === "in_progress" ? "in_progress" : "accepted",
      contractorId,
      start,
      end,
      title: doc?.jobTitle || w.wo_ref,
      woRef: w.wo_ref,
      workOrderId: w.id,
      offerId: acc?.id ?? null,
      paymentCents: w.contractor_payment_cents,
      finishCode: doc?.finishCode ?? null,
      expiresAt: null,
      source: null,
      reason: "",
    });
  }

  // --- blocked-out days ---
  type URow = { id: string; contractor_id: string; start_date: string; end_date: string; reason: string; source: "contractor" | "staff" };
  for (const u of (unavail as URow[] | null) ?? []) {
    blocks.push({
      id: `unav-${u.id}`,
      kind: "unavailable",
      contractorId: u.contractor_id,
      start: u.start_date,
      end: u.end_date,
      title: u.reason || (u.source === "staff" ? "Blocked by office" : "Unavailable"),
      woRef: "",
      workOrderId: null,
      offerId: null,
      paymentCents: null,
      finishCode: null,
      expiresAt: null,
      source: u.source,
      reason: u.reason,
    });
  }

  // --- the tray: issued jobs with nothing live and no accepted booking --------
  const liveWoIds = new Set(allOffers.filter((o) => isLive(effectiveState(o))).map((o) => o.work_order_id));
  const declineByWo = new Map<string, string>();
  for (const o of allOffers) {
    if (o.state === "declined" && o.decline_reason) declineByWo.set(o.work_order_id, o.decline_reason);
  }

  const tray: TrayJob[] = wos
    .filter((w) => !acceptedByWo.has(w.id) && !liveWoIds.has(w.id) && !(w.contractor_id && w.start_date))
    .map((w) => {
      const doc = snapshotOf(w.wo_snapshot);
      const hours = doc ? doc.areas.flatMap((a) => a.surfaces).reduce((n, s) => n + (s.hours ?? 0), 0) : 0;
      return {
        workOrderId: w.id,
        woRef: w.wo_ref,
        title: doc?.jobTitle || w.wo_ref,
        // The tray is a staff surface, so the full address is fine — but the
        // suburb reads better at this size.
        suburb: (doc?.jobAddress || "").split(",").slice(-3, -2)[0]?.trim() || doc?.jobAddress || "",
        paymentCents: w.contractor_payment_cents,
        finishCode: doc?.finishCode ?? null,
        hours: hours || null,
        estimatedDays: daysFromHours(hours),
        lastDeclineReason: declineByWo.get(w.id) ?? "",
      };
    });

  // Anything waiting on a staff decision, newest first. These need chasing even
  // when their dates sit outside the visible window, so they are NOT filtered
  // by the date range.
  const laneName = new Map(lanes.map((l) => [l.contractorId, l.name]));
  const approvals: Approval[] = allOffers
    .filter((o) => o.state === "proposed")
    .sort((a, b) => (a.responded_at ?? "").localeCompare(b.responded_at ?? ""))
    .map((o) => {
      const w = woById.get(o.work_order_id);
      const doc = snapshotOf(w?.wo_snapshot);
      return {
        offer: o,
        woRef: w?.wo_ref ?? "",
        title: doc?.jobTitle || w?.wo_ref || "Job",
        contractorName: laneName.get(o.contractor_id) ?? "Contractor",
      };
    });

  return { lanes, blocks, tray, approvals, errors };
}
