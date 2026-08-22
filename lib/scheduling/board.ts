import { createClient } from "@/lib/supabase/server";
import { addDays } from "./dates";
import { reportIfError } from "@/lib/monitoring/report";
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
  /** For linking back to the builder, which is addressed by ESTIMATE id. */
  estimateId: string | null;
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
  estimateId: string;
  woRef: string;
  title: string;
  suburb: string;
  paymentCents: number | null;
  finishCode: string | null;
  estimatedDays: number;
  hours: number | null;
  /** Set when a previous contractor declined — worth flagging to staff. */
  lastDeclineReason: string;
  /**
   * The chase log: what we have said to this customer while trying to book
   * them in. Staff-only (wo_booking_notes has no customer policy), newest
   * first. Empty when nobody has rung them yet.
   */
  notes: { id: string; note: string; at: string; author: string }[];
  /**
   * Why WE pulled the last offer, when we did. The contractor declining is a
   * different thing and reads on `lastDeclineReason` — this is the office's
   * own note from the cancel dialog, which was being written and never shown.
   */
  cancelledReason: string;
  /**
   * Set when the last offer on this job ran out its 24 hours unanswered, so the
   * job came back here on its own. Staff never chose to withdraw it and would
   * otherwise have no idea why it reappeared — see expire_booking_offers().
   */
  lapsed: { contractorName: string; at: string } | null;
  /**
   * Accepted but not yet issued. It can't be offered until the work order is
   * issued (that's what freezes the document the contractor reads), but it MUST
   * still be visible here — otherwise accepted jobs quietly pile up somewhere
   * the scheduler never looks.
   */
  needsIssuing: boolean;
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
  // Best-effort: a board that shows a stale offer is better than no board.
  // Reported, though — if this starts failing, offers stop lapsing on screen.
  reportIfError(await supabase.rpc("expire_booking_offers"), {
    where: "board.expireSweep",
    bestEffort: true,
  });

  const [
    { data: contractors, error: cErr },
    { data: workOrders, error: wErr },
    { data: offers, error: oErr },
    { data: unavail, error: uErr },
    { data: bookingNotes, error: nErr },
  ] = await Promise.all([
      supabase
        .from("contractors")
        .select("id, tier, active, offerable, company_name, crew_size, profiles ( name )")
        .order("company_name"),
      // Drafts included on purpose — see TrayJob.needsIssuing.
      supabase
        .from("work_orders")
        .select("id, estimate_id, wo_ref, status, contractor_id, start_date, contractor_payment_cents, wo_snapshot, issued_at, estimates ( title )"),
      // Windowed rather than "every offer ever made" (audit S6). The window is
      // widened past the visible range on purpose: a settled offer still
      // supplies the tray's "last declined because…" note, and a proposal
      // awaiting staff must appear in the approvals queue even when its dates
      // sit outside the columns on screen.
      supabase
        .from("booking_offers")
        .select(OFFER_COLUMNS)
        .or(`state.in.(offered,proposed),and(start_date.lte.${addDays(to, 30)},start_date.gte.${addDays(from, -180)})`),
      supabase
        .from("contractor_unavailability")
        .select("id, contractor_id, start_date, end_date, reason, source")
        .lte("start_date", to)
        .gte("end_date", from),
      // The chase log. Every unbooked job's notes in one query rather than one
      // per tray card; the table is staff-only, so a non-staff session simply
      // gets nothing back rather than an error.
      //
      // No `profiles:author(name)` embed here, however tempting: `author`
      // references auth.users, PostgREST cannot follow a foreign key into the
      // auth schema, and the whole query 400s with PGRST200. Names are resolved
      // in a second query below.
      supabase
        .from("wo_booking_notes")
        .select("id, work_order_id, note, author, created_at")
        .order("created_at", { ascending: false }),
    ]);

  // An empty board because a query failed looks exactly like an empty board
  // because there is no work — so say which it is.
  const errors = [
    cErr && `contractors: ${cErr.message}`,
    wErr && `work orders: ${wErr.message}`,
    oErr && `offers: ${oErr.message}`,
    uErr && `unavailability: ${uErr.message}`,
    // Surfaced, not swallowed. The first version of this query used a PostgREST
    // embed that 400s, and because only `data` was destructured the notes just
    // silently never appeared — the write had worked, so nothing looked wrong.
    nErr && `booking notes: ${nErr.message}`,
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
    id: string; estimate_id: string; wo_ref: string; status: string; contractor_id: string | null;
    start_date: string | null; contractor_payment_cents: number | null; wo_snapshot: unknown;
    issued_at: string | null; estimates: { title: string | null } | null;
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
      estimateId: w?.estimate_id ?? null,
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
    if (!w.issued_at) continue; // a draft has no contractor-facing document yet
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
      estimateId: w.estimate_id,
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
      estimateId: null,
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

  const noteRows = (bookingNotes ?? []) as unknown as {
    id: string; work_order_id: string; note: string; author: string | null; created_at: string;
  }[];

  // Who wrote each one. A separate query because the FK points at auth.users;
  // only the authors actually present are looked up.
  const authorIds = [...new Set(noteRows.map((n) => n.author).filter(Boolean))] as string[];
  const authorName = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: people } = await supabase.from("profiles").select("id, name").in("id", authorIds);
    for (const p of (people ?? []) as { id: string; name: string | null }[]) {
      if (p.name) authorName.set(p.id, p.name);
    }
  }

  const notesByWo = new Map<string, TrayJob["notes"]>();
  for (const n of noteRows) {
    const list = notesByWo.get(n.work_order_id) ?? [];
    list.push({
      id: n.id, note: n.note, at: n.created_at,
      author: n.author ? authorName.get(n.author) ?? "" : "",
    });
    notesByWo.set(n.work_order_id, list);
  }

  // Why WE cancelled — the MOST RECENT cancellation on the job, by cancelled_at
  // rather than whichever row the query happened to return first. A job pulled
  // twice should read the reason it was pulled this time.
  const cancelledByWo = new Map<string, { reason: string; at: string }>();
  for (const o of allOffers) {
    if (o.state !== "cancelled" || !o.cancelled_reason) continue;
    const at = o.cancelled_at ?? "";
    const seen = cancelledByWo.get(o.work_order_id);
    if (!seen || at >= seen.at) cancelledByWo.set(o.work_order_id, { reason: o.cancelled_reason, at });
  }

  // Contractor display names, wanted by both the tray's lapse note and the
  // approvals queue below.
  const laneName = new Map(lanes.map((l) => [l.contractorId, l.name]));

  // --- the tray: issued jobs with nothing live and no accepted booking --------
  const liveWoIds = new Set(allOffers.filter((o) => isLive(effectiveState(o))).map((o) => o.work_order_id));
  const declineByWo = new Map<string, string>();
  for (const o of allOffers) {
    if (o.state === "declined" && o.decline_reason) declineByWo.set(o.work_order_id, o.decline_reason);
  }

  // The most recent lapse per job. Only the LATEST offer counts: a job offered
  // again after a lapse and then declined should read as declined, not as
  // still-lapsed, so a later outcome on the same job clears it.
  const lapsedByWo = new Map<string, { contractorName: string; at: string }>();
  const latestByWo = new Map<string, (typeof allOffers)[number]>();
  for (const o of allOffers) {
    const seen = latestByWo.get(o.work_order_id);
    // offered_at is when it went out; responded_at when it settled. Either
    // orders the offers on a job well enough to pick the latest one.
    const when = o.responded_at ?? o.offered_at ?? "";
    const seenWhen = seen ? (seen.responded_at ?? seen.offered_at ?? "") : "";
    if (!seen || when >= seenWhen) latestByWo.set(o.work_order_id, o);
  }
  for (const [woId, o] of latestByWo) {
    if (effectiveState(o) !== "expired") continue;
    lapsedByWo.set(woId, {
      contractorName: laneName.get(o.contractor_id) ?? "The contractor",
      at: o.responded_at ?? o.expires_at ?? "",
    });
  }

  const tray: TrayJob[] = wos
    .filter((w) => !acceptedByWo.has(w.id) && !liveWoIds.has(w.id) && !(w.contractor_id && w.start_date))
    .map((w) => {
      const doc = snapshotOf(w.wo_snapshot);
      const hours = doc ? doc.areas.flatMap((a) => a.surfaces).reduce((n, s) => n + (s.hours ?? 0), 0) : 0;
      return {
        workOrderId: w.id,
        estimateId: w.estimate_id,
        woRef: w.wo_ref,
        // A draft has no snapshot, so fall back to the estimate's own title.
        title: doc?.jobTitle || w.estimates?.title || w.wo_ref,
        // The tray is a staff surface, so the full address is fine — but the
        // suburb reads better at this size.
        suburb: (doc?.jobAddress || "").split(",").slice(-3, -2)[0]?.trim() || doc?.jobAddress || "",
        paymentCents: w.contractor_payment_cents,
        finishCode: doc?.finishCode ?? null,
        hours: hours || null,
        estimatedDays: daysFromHours(hours),
        lastDeclineReason: declineByWo.get(w.id) ?? "",
        notes: notesByWo.get(w.id) ?? [],
        cancelledReason: cancelledByWo.get(w.id)?.reason ?? "",
        lapsed: lapsedByWo.get(w.id) ?? null,
        needsIssuing: !w.issued_at,
      };
    });

  // Anything waiting on a staff decision, newest first. These need chasing even
  // when their dates sit outside the visible window, so they are NOT filtered
  // by the date range.
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

  // Not-yet-issued jobs first — they're the ones needing a decision.
  tray.sort((a, b) => Number(b.needsIssuing) - Number(a.needsIssuing));

  return { lanes, blocks, tray, approvals, errors };
}
