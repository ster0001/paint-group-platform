import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/contractor/session";
import { getContractorJob } from "@/lib/contractor/jobs";
import WorkOrderDoc from "@/app/w/WorkOrderDoc";
import RescheduleRequest from "./RescheduleRequest";
import OfferBar from "./OfferBar";
import StartJob from "./StartJob";
import TickList from "@/app/components/wo/TickList";
import Variations, { type VariationView } from "./Variations";
import RequestClaim, { type ClaimableJob } from "@/app/portal/money/RequestClaim";
import { contractorVariationsCents, type PayVariation } from "@/lib/workorder/contractorPay";
import PrepChecklist, { type PrepItem } from "./PrepChecklist";
import FinishDate from "./FinishDate";
import ColourMatchCard from "@/app/components/wo/ColourMatchCard";
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
import { requestNowMs } from "@/lib/time/requestClock";

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

  // The booking behind this job: an accepted one can be asked to move, and a
  // still-OFFERED one pins its clock + accept/decline to the top (Tom, 25 Aug).
  const { data: offerRows } = await supabase
    .from("booking_offers")
    .select(OFFER_COLUMNS)
    .eq("work_order_id", id)
    .in("state", ["offered", "accepted", "proposed"])
    .order("offered_at", { ascending: false })
    .limit(1);
  const booking0 = ((offerRows as BookingOffer[] | null) ?? [])[0] ?? null;
  const liveOffer =
    booking0 && booking0.state === "offered" &&
    (!booking0.expires_at || new Date(booking0.expires_at).getTime() > requestNowMs())
      ? booking0
      : null;
  const booking = booking0 && booking0.state !== "offered" ? booking0 : null;

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
  const [{ data: surfaceRows }, { data: photoRows }, { data: woRow }, { data: walkthroughRows }, { data: qaRows }, { data: signoffRow }] = await Promise.all([
    supabase.from("wo_surfaces")
      .select("id, heading, heading_meta, label, state, rectification, removed_from_scope")
      .eq("work_order_id", id).order("sort", { ascending: true }),
    supabase.from("wo_photos")
      .select("area, kind").eq("work_order_id", id).in("kind", ["before", "completion"]),
    supabase.from("work_orders").select("stage, walkthrough_required, colours, wo_ref, contractor_payment_cents").eq("id", id).maybeSingle(),
    supabase.from("wo_walkthroughs")
      .select("kind, scheduled_date, status").eq("work_order_id", id)
      .eq("status", "booked"),
    supabase.from("wo_qa_checks")
      .select("id, result, kind, scheduled_for").eq("work_order_id", id),
    supabase.from("wo_signoff").select("signed_at, signed_name").eq("work_order_id", id).maybeSingle(),
  ]);

  // Requested or confirmed — derived from the live offer, never stored twice.
  const { data: bookingRows } = await supabase.rpc("wo_booking", { p_work_order_id: id });
  const bookingRow = ((bookingRows as { state: string; start_date: string | null; end_date: string | null }[] | null) ?? [])[0];
  const woBooking: Booking = bookingRow
    ? { state: bookingRow.state as Booking["state"], startDate: bookingRow.start_date, endDate: bookingRow.end_date }
    : { state: "none", startDate: job.startDate, endDate: job.endDate };

  const { data: prepRows } = await supabase
    .from("wo_checklist_items")
    .select("id, label, detail, required, done_at, kind, item_key, answer, answer_note")
    .eq("work_order_id", id).eq("phase", "completion_prep").order("sort");
  // The pre-start colours question: a No opens the colour-match work for the painter.
  const { data: coloursItem } = await supabase.from("wo_checklist_items").select("answer")
    .eq("work_order_id", id).eq("phase", "pre_start").eq("item_key", "colours").maybeSingle();
  // How many required pre-start items are still unticked — the contractor's
  // Start button unlocks at zero (the SQL gate re-checks on the actual start).
  const { data: preStartOpen } = await supabase.from("wo_checklist_items")
    .select("id, done_at, required")
    .eq("work_order_id", id).eq("phase", "pre_start").eq("required", true).is("done_at", null);
  const preStartLeft = (preStartOpen ?? []).length;
  const coloursNo = (coloursItem as { answer?: string | null } | null)?.answer === "no";

  type PrepRow = {
    id: string; label: string; detail: string | null; required: boolean; done_at: string | null;
    kind: string | null; item_key: string | null; answer: string | null; answer_note: string | null;
  };
  const toPrepItem = (r: PrepRow): PrepItem => ({
    id: r.id, label: r.label, detail: r.detail ?? "", required: r.required, done: r.done_at !== null,
    kind: r.kind === "yes_no" || r.kind === "note" ? r.kind : "tick",
    itemKey: r.item_key, answer: r.answer === "yes" || r.answer === "no" ? r.answer : null,
    answerNote: r.answer_note ?? "",
  });
  const prepItems: PrepItem[] = ((prepRows as PrepRow[] | null) ?? []).map(toPrepItem);

  const { data: ciTotals } = await supabase
    .from("contractor_invoices")
    .select("total_inc_cents").eq("work_order_id", id).neq("status", "draft");

  const { data: variationRows } = await supabase
    .from("wo_variations")
    .select("id, category, comment, status, contractor_delta_cents, est_hours, released_at, credit, needs_manual_deduction, deduction_cents, deduction_note, contractor_acknowledged_at")
    .eq("work_order_id", id)
    .order("created_at", { ascending: false });

  const variations: VariationView[] = ((variationRows as {
    id: string; category: string; comment: string; status: VariationView["status"];
    contractor_delta_cents: number | null; est_hours: number | null; released_at: string | null;
    credit: boolean; needs_manual_deduction: boolean; deduction_cents: number | null;
    deduction_note: string; contractor_acknowledged_at: string | null;
  }[] | null) ?? []).map((v) => ({
    id: v.id, category: v.category, comment: v.comment, status: v.status,
    contractorDeltaCents: v.contractor_delta_cents,
    estHours: v.est_hours === null ? null : Number(v.est_hours),
    released: v.released_at !== null,
    credit: v.credit,
    needsManualDeduction: v.needs_manual_deduction,
    deductionCents: v.deduction_cents,
    deductionNote: v.deduction_note ?? "",
    acknowledged: v.contractor_acknowledged_at !== null,
  }));

  // "Create invoice" from the job itself (Tom, 25 Aug): the same claim card
  // the Money tab carries, scoped to THIS job's remaining money.
  const woMoney = woRow as { wo_ref?: string; contractor_payment_cents?: number | null } | null;
  const payVars: PayVariation[] = ((variationRows as {
    status: string; credit: boolean; contractor_delta_cents: number | null;
    deduction_cents: number | null; needs_manual_deduction: boolean;
  }[] | null) ?? []);
  const claimJob: ClaimableJob = {
    workOrderId: id,
    woRef: woMoney?.wo_ref ?? "",
    title: job.doc?.jobTitle || job.doc?.jobAddress || woMoney?.wo_ref || "This job",
    adjustedCents: Math.max(0, Number(woMoney?.contractor_payment_cents ?? job.doc?.contractorPaymentCents ?? 0) + contractorVariationsCents(payVars)),
    invoicedCents: ((ciTotals as { total_inc_cents: number }[] | null) ?? [])
      .reduce((sum, c) => sum + c.total_inc_cents, 0),
    deductionPending: payVars.some((v) => v.credit && v.needs_manual_deduction && v.deduction_cents == null),
  };

  const surfaces: SurfaceRow[] = ((surfaceRows as
    { id: string; heading: string; label: string; state: SurfaceRow["state"]; rectification: boolean; removed_from_scope: boolean }[] | null) ?? [])
    .map((r) => ({ id: r.id, heading: r.heading, label: r.label, state: r.state, rectification: r.rectification, removed: r.removed_from_scope }));

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
  let stage = (woRow as { stage?: string } | null)?.stage;
  const walkthroughRequired = (woRow as { walkthrough_required?: boolean | null } | null)?.walkthrough_required !== false;
  const woColours = ((woRow as { colours?: Record<string, { match?: { code?: string; brand?: string; canSize?: string; by?: string } }> | null } | null)?.colours) ?? {};
  const canTick = stage === "in_progress";
  // Live states are already on this page; done means done, not prepped.
  // Struck surfaces are out of the working set — a job whose only leftovers
  // are removed-from-scope rows is finishable.
  const workingSurfaces = surfaces.filter((s) => !s.removed);
  const allSurfacesDone = workingSurfaces.length > 0 && workingSurfaces.every((s) => s.state === "done");
  // Every check passed but the job still parked at qa (passed before the
  // routing existed, or a page that never refreshed): the MACHINE moves it on
  // the moment anyone looks — the painter never presses anything customer-
  // facing (Tom, 23 Aug). A pack-gate refusal is shown in its own words.
  const qaList = ((qaRows ?? []) as { id: string; result: string | null }[]);
  const qaPassed = qaList.length > 0 && qaList.every((q) => q.result === "pass");
  let qaHold: string | null = null;
  if (stage === "qa" && qaPassed) {
    const { data: routed } = await supabase.rpc("wo_qa_route_passed", { p_work_order_id: id });
    const r = String(routed ?? "");
    if (r === "ok:walkthrough") {
      // Different-shape refetch (the Next fetch-memo trap): read the stage again.
      const { data: again } = await supabase.from("work_orders").select("stage, id").eq("id", id).maybeSingle();
      stage = ((again as { stage?: string } | null)?.stage ?? "walkthrough") as typeof stage;
    } else if (r.startsWith("error:gate:")) {
      qaHold = r.slice("error:gate:".length);
    }
  }
  const atWalkthrough = stage === "walkthrough";
  const bookedFinal = ((walkthroughRows ?? []) as { kind: string; scheduled_date: string }[])
    .find((w) => w.kind === "final")?.scheduled_date ?? null;
  const canPrep = stage === "completion_prep";
  // The finishing-up list belongs to the TICK-OFF step now (Tom, 23 Aug): it
  // appears the moment every surface is done, while the job still reads
  // In progress. Seed on demand — idempotent, and the refetch picks it up.
  if ((canPrep || (canTick && allSurfacesDone)) && prepItems.length === 0) {
    const { data: seeded } = await supabase.rpc("wo_seed_prep_checklist", { p_work_order_id: id });
    if (String(seeded ?? "").startsWith("ok:") && String(seeded) !== "ok:0") {
      // The refetch MUST NOT be byte-identical to the page's earlier prep
      // query: Next memoises fetches per request, and an identical URL would
      // hand back the pre-seed EMPTY result — the list then only appeared on
      // the NEXT page view (found 23 Aug, masked for a while by the router
      // firing double requests). `sort` in the select changes the URL.
      const { data: fresh } = await supabase.from("wo_checklist_items")
        .select("id, label, detail, required, done_at, kind, item_key, answer, answer_note, sort")
        .eq("work_order_id", id).eq("phase", "completion_prep").order("sort");
      prepItems.length = 0;
      for (const r of ((fresh ?? []) as PrepRow[])) prepItems.push(toPrepItem(r));
    }
  }


  return (
    <div className="wrap" style={{ paddingLeft: 0, paddingRight: 0 }}>
      <div style={{ padding: "0 16px" }}>
        <Link href={from === "requests" ? "/portal/requests" : from === "calendar" ? "/portal/calendar" : "/portal/jobs"}
          className="backlink" data-testid="job-back">
          ← {from === "requests" ? "Offers" : from === "calendar" ? "Calendar" : "Jobs"}
        </Link>
        {liveOffer && (
          <OfferBar offerId={liveOffer.id} expiresAt={liveOffer.expires_at}
            priceCents={liveOffer.payment_cents ?? null} />
        )}
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
      {/* Tom (25 Aug): once the job has STARTED, the reschedule bar goes —
          moving a live job is a phone call, not a button. */}
      {stage === "pre_start" && job.committed && (
        <StartJob workOrderId={id} blockedCount={preStartLeft} />
      )}
      {booking && ["offered", "pre_start"].includes(stage ?? "") && (
        <RescheduleRequest
          offerId={booking.id}
          currentStart={booking.prior_start_date ?? booking.start_date}
          pending={booking.state === "proposed"}
          proposedDate={booking.proposed_start_date}
          blocks={blocks}
          jobDays={jobDays}
        />
      )}

      {/* Signed and closed: the job is complete — the first thing the painter
          sees coming back from the sign-off (Tom, 23 Aug). */}
      {stage === "closed" && (
        <div style={{ padding: "0 16px" }}>
          <div className="card" data-testid="job-complete">
            <div className="tick-head"><b>Job complete</b><span className="tick-count">signed off</span></div>
            <p className="hint" style={{ padding: 0, marginTop: 6 }}>
              {(() => {
                const so = signoffRow as { signed_at?: string | null; signed_name?: string | null } | null;
                return so?.signed_at
                  ? `Signed off by ${so.signed_name || "the customer"} on ${new Date(so.signed_at).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}. Nice work — nothing more to do here.`
                  : "Signed off and closed. Nice work — nothing more to do here.";
              })()}
            </p>
          </div>
        </div>
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

      {/* Every surface done → the finishing-up list joins the tick-off step,
          and one press routes the job (the hidden prep stage is the server's
          business, not the painter's). A job staff parked mid-hand-over gets
          the same screen. */}
      {((canTick && allSurfacesDone) || canPrep) && (
        <div style={{ padding: "0 16px" }}>
          {prepItems.length > 0 && <PrepChecklist items={prepItems} />}
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
              {qaHold
                ? `The quality check has passed. The walkthrough is waiting on the office: ${qaHold}.`
                : "Paint Group is quality checking this job before sign-off. The walkthrough opens here the moment it passes — nothing for you to do unless something comes back to fix."}
            </p>
          </div>
        </div>
      )}

      {/* Colour matches (Tom, 23 Aug): codes the painter supplies on the job. */}
      {job.committed && (
        <div style={{ padding: "0 16px" }}>
          <ColourMatchCard ui="pt" workOrderId={id} canEdit={stage !== "closed"} coloursNo={coloursNo}
            materials={(job.doc?.materials ?? []).map((m) => ({
              product: m.product, colourName: m.colourName,
              required: Boolean(m.colourMatch?.required),
              snapCode: m.colourMatch?.code ?? "", snapBrand: m.colourMatch?.brand ?? "", snapCan: m.colourMatch?.canSize ?? "",
              woMatch: woColours[m.product]?.match ?? null,
            }))} />
        </div>
      )}

      {/* The finish / walkthrough date, movable by the painter (Tom, 23 Aug),
          with any dated quality check the office has booked. */}
      {job.committed && stage !== "closed" && stage !== "offered" && walkthroughRequired && (
        <div style={{ padding: "0 16px" }}>
          <FinishDate workOrderId={id} finalDate={bookedFinal} endDate={woBooking.endDate}
            startDate={woBooking.startDate} stage={stage ?? ""}
            qaDates={((qaRows ?? []) as { kind: string; scheduled_for: string | null; result: string | null }[])
              .filter((q) => q.scheduled_for)
              .map((q) => ({ kind: q.kind, date: q.scheduled_for as string, result: q.result }))} />
        </div>
      )}

      {job.committed && !walkthroughRequired && stage !== "closed" && stage !== "offered" && (
        <div style={{ padding: "0 16px" }}>
          <div className="card" data-testid="no-walkthrough">
            <div className="tick-head"><b>No customer walkthrough on this job</b></div>
            <p className="hint" style={{ padding: 0, marginTop: 6 }}>
              Once you&rsquo;ve finished (and any quality check has passed) the job closes on its own —
              Paint Group invoices the customer. Nothing to book.
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

      {job.committed && (
        <div style={{ padding: "0 16px" }}>
          <Variations workOrderId={id} variations={variations} />
          <div style={{ marginTop: 12 }}>
            <RequestClaim jobs={[claimJob]} heading="Invoice this job" />
          </div>
        </div>
      )}

      <WorkOrderDoc doc={job.doc} booking={woBooking} />
    </div>
  );
}
