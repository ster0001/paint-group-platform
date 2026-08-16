import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/contractor/session";
import { getContractorJob } from "@/lib/contractor/jobs";
import WorkOrderDoc from "@/app/w/WorkOrderDoc";
import RescheduleRequest from "./RescheduleRequest";
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
    ? [{ date: job.startDate, label: job.doc.jobTitle, status: job.status }]
    : [];

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

      <WorkOrderDoc doc={job.doc} />
    </div>
  );
}
