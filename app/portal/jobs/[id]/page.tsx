import Link from "next/link";
import { notFound } from "next/navigation";
import { reportError } from "@/lib/monitoring/report";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/contractor/session";
import { getContractorJob } from "@/lib/contractor/jobs";
import { getEmployeeJob } from "@/lib/contractor/employeeJobs";
import AssignmentCard from "./AssignmentCard";
import WorkOrderDoc from "@/app/w/WorkOrderDoc";
import { scopeChangesFrom } from "@/lib/workorder/scopeChanges";
import RescheduleRequest from "./RescheduleRequest";
import OfferBar from "./OfferBar";
import StartJob from "./StartJob";
import TickList from "@/app/components/wo/TickList";
import Variations, { type EmployeeVariationView, type VariationView } from "./Variations";
import RequestClaim, { type ClaimableJob } from "@/app/portal/money/RequestClaim";
import { contractorVariationsCents, type PayVariation } from "@/lib/workorder/contractorPay";
import PrepChecklist, { type PrepItem } from "./PrepChecklist";
import FinishDate from "./FinishDate";
import ColourMatchCard from "@/app/components/wo/ColourMatchCard";
import FinishUp, { type HoursAsk } from "./FinishUp";
import { scheduleDays } from "@/lib/reporting/workedTime";
import WalkthroughStart from "./WalkthroughStart";
import WalkthroughBar from "./WalkthroughBar";
import CrewShare from "./CrewShare";
import SitePhotos from "./SitePhotos";
import { photoScopeFor, type SurfaceRow } from "@/lib/workorder/surfaces";
import { qaAllClear, staffSignsOff as staffSignsOffFor } from "@/lib/workorder/qa";
import PhotoGrid from "@/app/components/wo/PhotoGrid";
import { signPhotos, type WOPhoto, type WOPhotoRow } from "@/lib/workorder/photos";
import type { Booking } from "@/lib/workorder/booking";
import { OFFER_COLUMNS, type BookingOffer } from "@/lib/scheduling/offers";
import type { PortalBlock, PortalJobDay } from "@/app/portal/calendar/CalendarGrid";
import { jobDaysFor } from "@/lib/contractor/jobDays";
import { suburbOnly } from "@/lib/scheduling/offers";
import { requestNowMs } from "@/lib/time/requestClock";
import { loadMyTimesheet } from "@/lib/contractor/timesheets";
import TimesheetCard from "@/app/portal/TimesheetCard";

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
  const { contractor, capabilities } = await requireContractor();
  if (!contractor) notFound();

  // Employed painters (S3): the same page, the other loader. An assigned job
  // arrives through the money-free RPC with `assignment` set; the document is
  // stripped in SQL and the sections below that are about offers, invoices
  // and the contractor's price branch on `capabilities`, never on the shape.
  const employee = !capabilities.seesMoney;
  const job = employee ? await getEmployeeJob(id) : await getContractorJob(contractor.id, id);
  if (!job || !job.doc) notFound();
  const assignment = job.assignment ?? null;

  // Best-effort "seen it" stamp so staff know the job landed.
  const supabase = await createClient();
  await supabase.rpc("contractor_mark_wo_viewed", { p_work_order_id: id }).then(
    () => {},
    () => {},
  );

  // The booking behind this job: an accepted one can be asked to move, and a
  // still-OFFERED one pins its clock + accept/decline to the top (Tom, 25 Aug).
  // An employee has no offers (and no read on the table).
  const { data: offerRows } = employee ? { data: null } : await supabase
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

  // Dashboard 0c (Tom, 19 Sep): only a painter the office opted in is asked
  // for days and hours at the final tick, pre-filled from the booking. The
  // flag is on their own contractors row (self-read RLS); the day length is
  // the Settings value through worked_day_hours() (settings are staff-only).
  const flagRes = await supabase.from("contractors")
    .select("capture_worked_hours, works_saturday, works_sunday").eq("id", contractor.id).maybeSingle();
  if (flagRes.error) reportError(flagRes.error, { where: "portal.job.workedHoursFlag", bestEffort: true, extra: { workOrderId: id } });
  const flagRow = flagRes.data as { capture_worked_hours: boolean | null; works_saturday: boolean | null; works_sunday: boolean | null } | null;
  let hoursAsk: HoursAsk | null = null;
  if (flagRow?.capture_worked_hours) {
    const dayRes = await supabase.rpc("worked_day_hours");
    if (dayRes.error) reportError(dayRes.error, { where: "portal.job.workedDayHours", bestEffort: true });
    const dayHours = Number(dayRes.data ?? 8) || 8;
    const bookedDays = booking?.start_date && booking?.end_date
      ? scheduleDays(booking.start_date, booking.end_date, { worksSaturday: Boolean(flagRow.works_saturday), worksSunday: Boolean(flagRow.works_sunday) })
      : null;
    hoursAsk = { days: bookedDays, hours: bookedDays != null ? bookedDays * dayHours : null };
  }

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
  const [{ data: surfaceRows }, { data: photoRows }, { data: woRow }, { data: walkthroughRows }, { data: qaRows }, { data: signoffRow }, { data: qaLinkRows, error: qaLinkErr }] = await Promise.all([
    supabase.from("wo_surfaces")
      .select("id, heading, heading_meta, label, state, rectification, removed_from_scope, photos_optional")
      .eq("work_order_id", id).order("sort", { ascending: true }),
    supabase.from("wo_photos")
      .select("area, kind").eq("work_order_id", id).in("kind", ["before", "completion"]),
    // The employee's stage/flags came with the RPC — the direct read is
    // refused for them (20270153), and would carry the price anyway.
    assignment
      ? Promise.resolve({ data: { stage: assignment.stage, walkthrough_required: assignment.walkthroughRequired, colours: assignment.colours, wo_ref: job.woRef, contractor_payment_cents: null } })
      : supabase.from("work_orders").select("stage, walkthrough_required, colours, wo_ref, contractor_payment_cents").eq("id", id).maybeSingle(),
    supabase.from("wo_walkthroughs")
      .select("kind, scheduled_date, status").eq("work_order_id", id)
      .eq("status", "booked"),
    supabase.from("wo_qa_checks")
      .select("id, result, kind, scheduled_for, notes, checked_at").eq("work_order_id", id),
    supabase.from("wo_signoff").select("signed_at, signed_name, areas, evidence_pack_sent_at").eq("work_order_id", id).maybeSingle(),
    // Re-check links (migration 20270196), on their own so a stack without the
    // column loses only the links, never the page. Reported, never silent.
    supabase.from("wo_qa_checks").select("id, retry_of").eq("work_order_id", id),
  ]);
  if (qaLinkErr) reportError(qaLinkErr, { where: "portal.job.qaLinks", bestEffort: true, extra: { workOrderId: id } });

  // Requested or confirmed — derived from the live offer, never stored twice.
  const { data: bookingRows } = await supabase.rpc("wo_booking", { p_work_order_id: id });
  const bookingRow = ((bookingRows as { state: string; start_date: string | null; end_date: string | null }[] | null) ?? [])[0];
  const woBooking: Booking = bookingRow
    ? { state: bookingRow.state as Booking["state"], startDate: bookingRow.start_date, endDate: bookingRow.end_date }
    : { state: "none", startDate: job.startDate, endDate: job.endDate };
  // A reschedule the painter has asked for is not a booking yet: the original
  // date stands until staff decide (RescheduleRequest says exactly that). The
  // wo_booking() RPC reports the PROPOSED start for the office's benefit, which
  // on this page read "14 Sept – 8 Sept · 1 day" against the unchanged end
  // (6 Sep). Show them the booking they actually hold.
  if (booking && booking.state === "proposed" && booking.prior_start_date) {
    woBooking.startDate = booking.prior_start_date;
    woBooking.endDate = booking.end_date;
  }

  const { data: prepRows } = await supabase
    .from("wo_checklist_items")
    .select("id, label, detail, required, done_at, kind, item_key, answer, answer_note")
    .eq("work_order_id", id).eq("phase", "completion_prep").order("sort");
  // The pre-start colours question: a No opens the colour-match work for the painter.
  const { data: coloursItem } = await supabase.from("wo_checklist_items").select("answer")
    .eq("work_order_id", id).eq("phase", "pre_start").eq("item_key", "colours").maybeSingle();
  // How many required pre-start items are still unticked — the painter's
  // Start button unlocks at zero (the SQL gate re-checks on the actual start).
  // Read the WHOLE list, not just the open ones: zero open items means "the
  // office is done" only if there is a list to be done with. A job with no
  // list at all used to read as ready here and start on a tap — 20270173
  // refuses it in SQL, and this stops the button promising what SQL will
  // refuse. The error is kept: a refused read must not render as "ready".
  const { data: preStartRows, error: preStartErr } = await supabase.from("wo_checklist_items")
    .select("id, done_at, required")
    .eq("work_order_id", id).eq("phase", "pre_start");
  const preStartItems = ((preStartErr ? null : preStartRows) ?? []) as
    { id: string; done_at: string | null; required: boolean }[];
  const preStartListBuilt = !preStartErr && preStartItems.length > 0;
  const preStartLeft = preStartItems.filter((r) => r.required && r.done_at === null).length;
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

  // Money reads: a contractor's invoices and priced variations. An employee
  // has neither (rulings 3, 4, 8) — Session 4 gives them the "Variation
  // approved" card with scope and hours; until then nothing is read.
  const { data: ciTotals } = employee ? { data: null } : await supabase
    .from("contractor_invoices")
    .select("total_inc_cents").eq("work_order_id", id).neq("status", "draft");

  const { data: variationRows } = employee ? { data: null } : await supabase
    .from("wo_variations")
    .select("id, category, comment, status, contractor_delta_cents, est_hours, released_at, credit, needs_manual_deduction, deduction_cents, deduction_note, contractor_acknowledged_at, customer_responded_at, created_at")
    .eq("work_order_id", id)
    .order("created_at", { ascending: false });

  // Employed painters (S4, ruling 8): the money-free read of the same rows.
  let employeeVariations: EmployeeVariationView[] = [];
  if (employee) {
    const { data: evRows, error: evError } = await supabase.rpc("employee_variations", { p_work_order_id: id });
    if (evError) reportError(evError, { where: "portal.job.employeeVariations", extra: { workOrderId: id } });
    employeeVariations = ((evError ? [] : evRows) ?? [] as unknown[]).map((r: unknown) => {
      const v = r as {
        id: string; category: string; comment: string; est_hours: number | string | null;
        outcome: EmployeeVariationView["outcome"]; scope_lines: unknown; office_note: string; credit: boolean;
      };
      const lines = Array.isArray(v.scope_lines) ? (v.scope_lines as Array<{ label?: unknown }>) : [];
      return {
        id: v.id, category: v.category, comment: v.comment,
        estHours: v.est_hours == null ? null : Number(v.est_hours),
        outcome: v.outcome, officeNote: v.office_note ?? "", credit: Boolean(v.credit),
        scopeLines: lines.map((l) => ({ label: typeof l.label === "string" ? l.label : "" })).filter((l) => l.label),
      };
    });
  }

  // "Can't make it" already on the record for these dates? (ruling 11)
  let cantMakeItFlagged = false;
  if (assignment) {
    const { data: flags, error: flagsError } = await supabase.rpc("employee_flag_state", { p_assignment_id: assignment.assignmentId });
    if (!flagsError) cantMakeItFlagged = String(flags ?? "") === "flagged";
  }

  type VRow = {
    id: string; category: string; comment: string; status: VariationView["status"];
    contractor_delta_cents: number | null; est_hours: number | null; released_at: string | null;
    credit: boolean; needs_manual_deduction: boolean; deduction_cents: number | null;
    deduction_note: string; contractor_acknowledged_at: string | null;
    customer_responded_at: string | null; created_at: string;
  };
  const vRows = (variationRows as VRow[] | null) ?? [];
  const variations: VariationView[] = vRows.map((v) => ({
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
    { id: string; heading: string; label: string; state: SurfaceRow["state"]; rectification: boolean; removed_from_scope: boolean; photos_optional?: boolean | null }[] | null) ?? [])
    .map((r) => ({ id: r.id, heading: r.heading, label: r.label, state: r.state, rectification: r.rectification, removed: r.removed_from_scope, photosOptional: Boolean(r.photos_optional) }));
  // One before + one finished photo on a short job (Tom, 24 Sep 2026) — the
  // same arithmetic wo_photo_scope runs, so the prompt and the gate agree.
  const photoScope = photoScopeFor(woBooking.startDate, woBooking.endDate);

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
  const qaList = ((qaRows ?? []) as { id: string; result: string | null; notes?: string | null; checked_at?: string | null }[]);
  // A failed check is settled once its re-check has passed (20270196): the
  // record keeps the FAIL, the job is not held by it.
  const qaRetryOf = new Map(((qaLinkErr ? [] : qaLinkRows ?? []) as { id: string; retry_of: string | null }[]).map((r) => [r.id, r.retry_of] as const));
  const qaPassed = qaAllClear(qaList.map((q) => ({ id: q.id, result: q.result, retryOf: qaRetryOf.get(q.id) ?? null })));
  // Tom, 24 Sep: a quality-checked job is signed off by the OFFICE — the
  // painter runs no walkthrough on it, and the customer is not asked to sign.
  const staffSignsOff = staffSignsOffFor(qaList);

  // A failed check with areas still to put right (Tom, 1 Sep #2): show the
  // inspector's notes, the missed areas and their photos right on the job.
  const outstandingRectify = surfaces.filter((s) => s.rectification && !s.removed && s.state !== "done");
  const failedCheck = outstandingRectify.length > 0
    ? qaList.filter((q) => q.result === "fail")
        .sort((a, b) => (b.checked_at ?? "").localeCompare(a.checked_at ?? ""))[0] ?? null
    : null;
  // The photos the office attached for this painter (20270190). RLS already
  // scopes wo_photos to the assigned contractor via wo_photo_access, so this is
  // the contractor's OWN session reading them — no service client, and a kind
  // filter so their own before/progress record is never handed back to them as
  // though it came from us.
  const { data: officeRows, error: officeErr } = await supabase
    .from("wo_photos")
    .select("id, work_order_id, kind, area, caption, storage_path, created_at")
    .eq("work_order_id", id).eq("kind", "reference")
    .order("created_at", { ascending: true });
  if (officeErr) reportError(officeErr, { where: "portal.job.officePhotos", bestEffort: true, extra: { workOrderId: id } });
  const officePhotos: WOPhoto[] = officeErr
    ? []
    : await signPhotos(supabase, (officeRows ?? []) as WOPhotoRow[]);

  let qaFailPhotos: WOPhoto[] = [];
  if (failedCheck) {
    const { data: qaPhotoRows } = await supabase
      .from("wo_photos")
      .select("id, work_order_id, kind, storage_path, area, caption, created_at, variation_id")
      .eq("work_order_id", id).eq("kind", "qa")
      .order("created_at", { ascending: false }).limit(12);
    qaFailPhotos = await signPhotos(supabase, (qaPhotoRows ?? []) as WOPhotoRow[]);
  }
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
  // Session 6: Start / Finish day on THIS job, hours only (clocksOn painters).
  const timesheet = capabilities.clocksOn && stage !== "closed" ? await loadMyTimesheet(id) : null;
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


  // Tom (17 Sep): every box ticked → a Start-the-walkthrough bar pinned under
  // the header, so the next step is never a scroll away. It stays through the
  // finish and the walkthrough stage; the quality check has its own notice.
  // A quality-checked job at the sign-off stage is the office's: no bar, a notice instead.
  // ...and a job whose walkthrough was switched off after it got here (Tom,
  // 24 Sep) has none to start either — the office closes it.
  const showWalkthroughBar = job.committed && ((atWalkthrough && !staffSignsOff && walkthroughRequired) || canPrep || (canTick && allSurfacesDone));
  const prepLeft = prepItems.filter((i) => i.required && !i.done).length;
  // Tom (17 Sep): areas the customer flagged at their walkthrough and nobody
  // has yet marked put right. While any exist on an in-progress job, the
  // finish IS the completion — report to the customer, job closed — never a
  // second walkthrough. Derived from the sign-off row's areas, not stored twice.
  const so = signoffRow as { signed_at?: string | null; evidence_pack_sent_at?: string | null;
    areas?: Record<string, { flagged_at?: string; rectified_at?: string }> | null } | null;
  const flaggedAreas = so && !so.signed_at && so.evidence_pack_sent_at
    ? Object.entries(so.areas ?? {}).filter(([, a]) => a?.flagged_at && !a?.rectified_at).map(([h]) => h)
    : [];
  const rectifiedPhase = canTick && flaggedAreas.length > 0;

  return (
    <div className="wrap" style={{ paddingLeft: 0, paddingRight: 0 }}>
      {showWalkthroughBar && (
        <WalkthroughBar workOrderId={id} phase={atWalkthrough ? "walkthrough" : rectifiedPhase ? "rectified" : "finish"}
          prepLeft={prepLeft} flaggedAreas={rectifiedPhase ? flaggedAreas : []} />
      )}
      <div style={{ padding: "0 16px" }}>
        <Link href={from === "requests" ? "/portal/requests" : from === "calendar" ? "/portal/calendar" : "/portal/jobs"}
          className="backlink" data-testid="job-back">
          ← {from === "requests" ? "Offers" : from === "calendar" ? "Calendar" : "Jobs"}
        </Link>
        {liveOffer && (
          <OfferBar offerId={liveOffer.id} workOrderId={id} expiresAt={liveOffer.expires_at}
            priceCents={liveOffer.payment_cents ?? null} />
        )}
        {assignment && stage !== "closed" && (
          <AssignmentCard assignment={assignment} flagged={cantMakeItFlagged} />
        )}
        {timesheet && (
          <TimesheetCard open={timesheet.open} recent={timesheet.recent} error={timesheet.error}
            workOrderId={id} jobTitle={claimJob.title}
            today={new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())} />
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
        <StartJob workOrderId={id} blockedCount={preStartLeft} listBuilt={preStartListBuilt} />
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

      {/* A failed quality check, in full: the inspector's notes, the missed
          areas and the photos showing exactly where (Tom, 1 Sep #2). The
          rectification rows themselves are on the tick list below. */}
      {failedCheck && (
        <div style={{ padding: "0 16px" }}>
          <div className="card amberish" data-testid="qa-fail-card">
            <span className="chip cly">Quality check — areas to put right</span>
            {failedCheck.notes?.trim() ? (
              <p style={{ marginTop: 10, fontSize: "13.5px" }}>&ldquo;{failedCheck.notes.trim()}&rdquo;</p>
            ) : null}
            <div style={{ marginTop: 8 }}>
              {outstandingRectify.map((s) => (
                <div key={s.id} style={{ fontSize: "13px", padding: "4px 0" }}>
                  <b>{s.heading}</b> — {s.label}
                </div>
              ))}
            </div>
            {qaFailPhotos.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <PhotoGrid photos={qaFailPhotos} tight showKind={false}
                  empty="" />
              </div>
            )}
            <p className="note" style={{ marginTop: 8 }}>
              Tick each one off below once it&rsquo;s put right — the check runs again after.
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
            photoScope={photoScope}
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
          <FinishUp workOrderId={id} flaggedAreas={rectifiedPhase ? flaggedAreas : []} hoursAsk={hoursAsk} />
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
                : "Paint Group is quality checking this job before sign-off. Once it passes, the office signs the job off — nothing for you to do unless something comes back to fix."}
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
              {atWalkthrough
                ? "Nothing to run on your phone — the office closes this job off and invoices the customer."
                : "Once you\u2019ve finished (and any quality check has passed) the job closes on its own — Paint Group invoices the customer. Nothing to book."}
            </p>
          </div>
        </div>
      )}

      {/* §4b Mode A: at the walkthrough stage the painter runs the sign-off
          from their own phone — unless the job was quality checked (Tom,
          24 Sep): then the office signs it off and there is nothing to run. */}
      {atWalkthrough && job.committed && !staffSignsOff && walkthroughRequired && (
        <div style={{ padding: "0 16px" }}>
          <WalkthroughStart workOrderId={id} finalDate={bookedFinal} />
        </div>
      )}
      {atWalkthrough && job.committed && staffSignsOff && (
        <div style={{ padding: "0 16px" }}>
          <div className="card" data-testid="staff-signoff-notice">
            <div className="tick-head"><b>Quality check passed</b></div>
            <p className="hint" style={{ padding: 0, marginTop: 6 }}>
              Paint Group signs this job off from the office — no walkthrough to run on your phone.
              The customer receives the completion report when it&rsquo;s signed, and the job reads complete here.
            </p>
          </div>
        </div>
      )}

      {/* Committed jobs only: an open offer's suburb-only view has nothing a
          crew needs, and the link would outlive a declined offer. A crew link
          is a contractor's thing (their own painters); an employee's
          colleagues are on the job by assignment already. */}
      {job.committed && capabilities.hasCrewCount && (
        <div style={{ padding: "0 16px" }}>
          <CrewShare workOrderId={id} />
        </div>
      )}

      {/* One variation card, two modes (ruling 8): a contractor accepts an
          adjusted offer; an employee is told the outcome — scope and hours,
          never a figure. The claim composer is contractor money (ruling 4). */}
      {job.committed && (
        <div style={{ padding: "0 16px" }}>
          <Variations workOrderId={id} variations={variations}
            mode={employee ? "employee" : "contractor"} employeeVariations={employeeVariations} />
          {capabilities.canSelfInvoice && (
            <div style={{ marginTop: 12 }}>
              <RequestClaim jobs={[claimJob]} heading="Invoice this job" />
            </div>
          )}
        </div>
      )}

      {/* The approved changes on the sheet itself (Tom, 23 Sep) — scope and
          hours for both kinds of painter; the pay line carries the accepted
          variations for a contractor, and an employee's sheet has no pay. */}
      <WorkOrderDoc doc={job.doc} booking={woBooking} photos={officePhotos}
        variant={assignment ? "employee" : "contractor"}
        acceptanceMode={assignment ? "assigned" : "offered"}
        scopeChanges={employee
          ? employeeVariations.filter((v) => v.outcome === "approved").map((v) => ({
              id: v.id, category: v.category, comment: v.comment, estHours: v.estHours,
              credit: v.credit, status: "contractor_accepted", approvedAt: null,
            }))
          : scopeChangesFrom(vRows)}
        payInclChanges={employee ? null : claimJob.adjustedCents} />
    </div>
  );
}
