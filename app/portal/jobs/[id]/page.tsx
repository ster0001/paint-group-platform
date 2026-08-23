import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/contractor/session";
import { getContractorJob } from "@/lib/contractor/jobs";
import WorkOrderDoc from "@/app/w/WorkOrderDoc";
import RescheduleRequest from "./RescheduleRequest";
import TickList from "@/app/components/wo/TickList";
import Variations, { type VariationView } from "./Variations";
import PrepChecklist, { type PrepItem } from "./PrepChecklist";
import ConfirmPrep from "./ConfirmPrep";
import FinishUp from "./FinishUp";
import WalkthroughStart from "./WalkthroughStart";
import CrewShare from "./CrewShare";
import SitePhotos from "./SitePhotos";
import type { SurfaceRow } from "@/lib/workorder/surfaces";
import type { Booking } from "@/lib/workorder/booking";
import { OFFER_COLUMNS, type BookingOffer } from "@/lib/scheduling/offers";
import type { PortalBlock, PortalJobDay } from "@/app/portal/calendar/CalendarGrid";
import { jobDaysFor } from "@/lib/contractor/jobDays";
import { suburbOnly } from "@/lib/scheduling/offers";

export const dynamic = "force-dynamic";

// The signed-in contractor's own work order. Same document the public
// /w/[token] link serves — read-only, contractor-safe, no customer pricing or
// margin — but reached through their login rather than a shared link.
export default async function PortalJobPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  // Where they came from, so "back" goes back rather than to a default the
  // painter has to re-navigate out of.
  const { from } = await searchParams;
  const { contractor } = await requireContractor();
  if (!contractor) notFound();

  const job = await getContractorJob(contractor.id, id);
  if (!job || !job.doc) notFound();

  // Best-effort "seen it" stamp so staff know the job landed.
  const supabase = await createClient();
  await supabase.rpc("contractor_mark_wo_viewed", { p_work_order_id: id }).then(
    () => {},
    () => {},
  );

  // The booking behind this job, so an accepted one can be asked to move.
  const { data: offerRows } = await supabase
    .from("booking_offers")
    .select(OFFER_COLUMNS)
    .eq("work_order_id", id)
    .in("state", ["accepted", "proposed"])
    .order("offered_at", { ascending: false })
    .limit(1);
  const booking = ((offerRows as BookingOffer[] | null) ?? [])[0] ?? null;

  const { data: u } = await supabase
    .from("contractor_unavailability")
    .select("id, start_date, end_date, reason, source")
    .eq("contractor_id", contractor.id);
  const blocks: PortalBlock[] = ((u as { id: string; start_date: string; end_date: string; reason: string; source: "contractor" | "staff" }[] | null) ?? [])
    .map((b) => ({ id: b.id, start: b.start_date, end: b.end_date, reason: b.reason, source: b.source }));
  // The whole booking, not just day one — this calendar is how a contractor
  // sees how long they are on site for.
  const jobDays: PortalJobDay[] = jobDaysFor([{ ...job, id }]);

  // The tick list and the before-photos already logged. RLS scopes both to this
  // contractor's own jobs, so an id that isn't theirs simply returns nothing.
  const [{ data: surfaceRows }, { data: photoRows }, { data: woRow }, { data: walkthroughRows }, { data: qaRows }] = await Promise.all([
    supabase.from("wo_surfaces")
      .select("id, heading, heading_meta, label, state, rectification")
      .eq("work_order_id", id).order("sort", { ascending: true }),
    supabase.from("wo_photos")
      .select("area, kind").eq("work_order_id", id).in("kind", ["before", "completion"]),
    supabase.from("work_orders").select("stage").eq("id", id).maybeSingle(),
    supabase.from("wo_walkthroughs")
      .select("kind, scheduled_date, status").eq("work_order_id", id)
      .eq("status", "booked"),
    supabase.from("wo_qa_checks")
      .select("id, result").eq("work_order_id", id),
  ]);

  // Requested or confirmed — derived from the live offer, never stored twice.
  const { data: bookingRows } = await supabase.rpc("wo_booking", { p_work_order_id: id });
  const bookingRow = ((bookingRows as { state: string; start_date: string | null; end_date: string | null }[] | null) ?? [])[0];
  const woBooking: Booking = bookingRow
    ? { state: bookingRow.state as Booking["state"], startDate: bookingRow.start_date, endDate: bookingRow.end_date }
    : { state: "none", startDate: job.startDate, endDate: job.endDate };

  const { data: prepRows } = await supabase
    .from("wo_checklist_items")
    .select("id, label, detail, required, done_at")
    .eq("work_order_id", id).eq("phase", "completion_prep").order("sort");

  const prepItems: PrepItem[] = ((prepRows as {
    id: string; label: string; detail: string | null; required: boolean; done_at: string | null;
  }[] | null) ?? []).map((r) => ({
    id: r.id, label: r.label, detail: r.detail ?? "", required: r.required, done: r.done_at !== null,
  }));

  const { data: variationRows } = await supabase
    .from("wo_variations")
    .select("id, category, comment, status, contractor_delta_cents, est_hours, released_at")
    .eq("work_order_id", id)
    .order("created_at", { ascending: false });

  const variations: VariationView[] = ((variationRows as {
    id: string; category: string; comment: string; status: VariationView["status"];
    contractor_delta_cents: number | null; est_hours: number | null; released_at: string | null;
  }[] | null) ?? []).map((v) => ({
    id: v.id, category: v.category, comment: v.comment, status: v.status,
    contractorDeltaCents: v.contractor_delta_cents,
    estHours: v.est_hours === null ? null : Number(v.est_hours),
    released: v.released_at !== null,
  }));

  const surfaces: SurfaceRow[] = ((surfaceRows as
    { id: string; heading: string; label: string; state: SurfaceRow["state"]; rectification: boolean }[] | null) ?? [])
    .map((r) => ({ id: r.id, heading: r.heading, label: r.label, state: r.state, rectification: r.rectification }));

  const headingMeta: Record<string, string> = {};
  for (const r of (surfaceRows as { heading: string; heading_meta: string }[] | null) ?? []) {
    if (r.heading_meta) headingMeta[r.heading] = r.heading_meta;
  }

  const photoAreas = (photoRows as { area: string; kind: string }[] | null) ?? [];
  const headingsWithBeforePhoto = [...new Set(
    photoAreas.filter((p) => p.kind === "before").map((p) => p.area).filter(Boolean),
  )];
  // The finished shots already in, so a done elevation stops asking.
  const headingsWithAfterPhoto = [...new Set(
    photoAreas.filter((p) => p.kind === "completion").map((p) => p.area).filter(Boolean),
  )];

  // Ticking only makes sense once the job is under way — before that the list is
  // still worth seeing, so it renders read-only via the server's own refusal.
  const stage = (woRow as { stage?: string } | null)?.stage;
  const canTick = stage === "in_progress";
  // Live states are already on this page; done means done, not prepped.
  const allSurfacesDone = surfaces.length > 0 && surfaces.every((s) => s.state === "done");
  const atWalkthrough = stage === "walkthrough";
  const bookedFinal = ((walkthroughRows ?? []) as { kind: string; scheduled_date: string }[])
    .find((w) => w.kind === "final")?.scheduled_date ?? null;
  const canPrep = stage === "completion_prep";
  const prepDone = prepItems.length > 0 && prepItems.every((i) => !i.required || i.done);
  const qaPending = ((qaRows ?? []) as { result: string | null }[])
    .some((c) => c.result === null || c.result === "fail");

  return (
    <div className="wrap" style={{ paddingLeft: 0, paddingRight: 0 }}>
      <div style={{ padding: "0 16px" }}>
        <Link href={from === "requests" ? "/portal/requests" : from === "calendar" ? "/portal/calendar" : "/portal/jobs"}
          className="backlink" data-testid="job-back">
          ← {from === "requests" ? "Offers" : from === "calendar" ? "Calendar" : "Jobs"}
        </Link>
        {!job.committed && (
          <div className="card amberish" style={{ marginTop: 4 }}>
            <span className="chip amb">Suburb only</span>
            {/* SHOW the suburb. This panel used to announce that the address was
                hidden without saying where the job actually was, so a contractor
                deciding whether to take it had to guess (Tom, 22 Aug). The
                address on `job.doc` is already reduced to the suburb by the
                server — see the privacy gate in lib/contractor/jobs.ts. */}
            <div style={{ marginTop: 8, fontSize: "15px", fontWeight: 600 }} data-testid="job-suburb">
              {suburbOnly(job.doc?.jobAddress)}
            </div>
            <div style={{ marginTop: 6, fontSize: "12.5px", color: "var(--muted)" }}>
              The full address and the customer&rsquo;s contact details unlock once you
              accept the booking.
            </div>
          </div>
        )}
      </div>
      {booking && (
        <RescheduleRequest
          offerId={booking.id}
          currentStart={booking.prior_start_date ?? booking.start_date}
          pending={booking.state === "proposed"}
          proposedDate={booking.proposed_start_date}
          blocks={blocks}
          jobDays={jobDays}
        />
      )}

      {canTick && surfaces.length > 0 && (
        <div style={{ padding: "0 16px" }}>
          <TickList
            workOrderId={id}
            surfaces={surfaces}
            headingsWithBeforePhoto={headingsWithBeforePhoto}
            headingsWithAfterPhoto={headingsWithAfterPhoto}
            headingMeta={headingMeta}
          />
        </div>
      )}

      {(canTick || canPrep) && (
        <div style={{ padding: "0 16px" }}>
          <SitePhotos workOrderId={id} areas={[...new Set(surfaces.map((s) => s.heading))]} />
        </div>
      )}

      {/* Every surface done → the painter finishes the job themselves. */}
      {canTick && allSurfacesDone && (
        <div style={{ padding: "0 16px" }}>
          <FinishUp workOrderId={id} />
        </div>
      )}

      {/* The QA notice (Tom, 23 Aug): while the job is being checked, the
          painter knows sign-off waits for it — no walkthrough date until then. */}
      {stage === "qa" && (
        <div style={{ padding: "0 16px" }}>
          <div className="card" data-testid="qa-notice">
            <div className="tick-head"><b>Quality check</b></div>
            <p className="hint" style={{ padding: 0, marginTop: 6 }}>
              Paint Group is quality checking this job before sign-off. The
              customer walkthrough gets booked once the check has passed —
              nothing for you to do here unless something comes back to fix.
            </p>
          </div>
        </div>
      )}

      {/* §4b Mode A: at the walkthrough stage the painter runs the sign-off
          from their own phone. */}
      {atWalkthrough && job.committed && (
        <div style={{ padding: "0 16px" }}>
          <WalkthroughStart workOrderId={id} finalDate={bookedFinal} />
        </div>
      )}

      {/* Committed jobs only: an open offer's suburb-only view has nothing a
          crew needs, and the link would outlive a declined offer. */}
      {job.committed && (
        <div style={{ padding: "0 16px" }}>
          <CrewShare workOrderId={id} />
        </div>
      )}

      {canPrep && prepDone && (
        <div style={{ padding: "0 16px" }}>
          <ConfirmPrep workOrderId={id} qaPending={qaPending} />
        </div>
      )}

      {canPrep && prepItems.length > 0 && (
        <div style={{ padding: "0 16px" }}>
          <PrepChecklist items={prepItems} />
        </div>
      )}

      {job.committed && (
        <div style={{ padding: "0 16px" }}>
          <Variations workOrderId={id} variations={variations} />
        </div>
      )}

      <WorkOrderDoc doc={job.doc} booking={woBooking} />
    </div>
  );
}
