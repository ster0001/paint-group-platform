import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/contractor/session";
import { getContractorJob } from "@/lib/contractor/jobs";
import WorkOrderDoc from "@/app/w/WorkOrderDoc";
import RescheduleRequest from "./RescheduleRequest";
import TickList from "./TickList";
import Variations, { type VariationView } from "./Variations";
import type { SurfaceRow } from "@/lib/workorder/surfaces";
import type { Booking } from "@/lib/workorder/booking";
import { OFFER_COLUMNS, type BookingOffer } from "@/lib/scheduling/offers";
import type { PortalBlock, PortalJobDay } from "@/app/portal/calendar/CalendarGrid";

export const dynamic = "force-dynamic";

// The signed-in contractor's own work order. Same document the public
// /w/[token] link serves — read-only, contractor-safe, no customer pricing or
// margin — but reached through their login rather than a shared link.
export default async function PortalJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const jobDays: PortalJobDay[] = job.startDate
    ? [{ date: job.startDate, label: job.doc.jobTitle, status: job.status, id }]
    : [];

  // The tick list and the before-photos already logged. RLS scopes both to this
  // contractor's own jobs, so an id that isn't theirs simply returns nothing.
  const [{ data: surfaceRows }, { data: photoRows }, { data: woRow }] = await Promise.all([
    supabase.from("wo_surfaces")
      .select("id, heading, heading_meta, label, state, rectification")
      .eq("work_order_id", id).order("sort", { ascending: true }),
    supabase.from("wo_photos")
      .select("area").eq("work_order_id", id).eq("kind", "before"),
    supabase.from("work_orders").select("stage").eq("id", id).maybeSingle(),
  ]);

  // Requested or confirmed — derived from the live offer, never stored twice.
  const { data: bookingRows } = await supabase.rpc("wo_booking", { p_work_order_id: id });
  const bookingRow = ((bookingRows as { state: string; start_date: string | null; end_date: string | null }[] | null) ?? [])[0];
  const woBooking: Booking = bookingRow
    ? { state: bookingRow.state as Booking["state"], startDate: bookingRow.start_date, endDate: bookingRow.end_date }
    : { state: "none", startDate: job.startDate, endDate: job.endDate };

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

  const headingsWithBeforePhoto = [...new Set(
    ((photoRows as { area: string }[] | null) ?? []).map((p) => p.area).filter(Boolean),
  )];

  // Ticking only makes sense once the job is under way — before that the list is
  // still worth seeing, so it renders read-only via the server's own refusal.
  const canTick = (woRow as { stage?: string } | null)?.stage === "in_progress";

  return (
    <div className="wrap" style={{ paddingLeft: 0, paddingRight: 0 }}>
      <div style={{ padding: "0 16px" }}>
        <Link href="/portal/jobs" className="backlink">
          ← Jobs
        </Link>
        {!job.committed && (
          <div className="card amberish" style={{ marginTop: 4 }}>
            <span className="chip amb">Suburb only</span>
            <div style={{ marginTop: 8, fontSize: "12.5px", color: "var(--muted)" }}>
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
            headingMeta={headingMeta}
          />
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
