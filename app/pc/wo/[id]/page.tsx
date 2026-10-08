import type { ReactNode } from "react";
import EstimatorNotes from "@/app/components/estimator-notes/EstimatorNotes";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import { LANES, LANE_LABELS, laneFor, stageTitle, type WoStage } from "@/lib/workorder/stages";
import { jobNeedsAfterPhotos, progressByHeading, progressOf, seedRowsFromDoc, type SurfaceRow } from "@/lib/workorder/surfaces";
import { staffSignsOff as staffSignsOffFor, supersededQaIds } from "@/lib/workorder/qa";
import PhotosOptionalToggle from "./PhotosOptionalToggle";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";
import { VARIATION_STEPS, stepIndex, type VariationStatus } from "@/lib/workorder/variations";
import PriceVariation from "./PriceVariation";
import UpdateComposer from "./UpdateComposer";
import Checklist, { type ChecklistItem } from "./Checklist";
import PrestartListBox from "./PrestartListBox";
import { loadPrestartList } from "@/lib/workorder/pcNotes";
import WalkthroughCard from "./WalkthroughCard";
import ReviewCard, { type ReviewState } from "./ReviewCard";
import QaCheck, { type QaCheckView } from "./QaCheck";
import QaControls from "./QaControls";
import QaSchedule from "./QaSchedule";
import { defaultQaWhen, qaCheckLabel } from "@/lib/workorder/qaSchedule";
import { inviteLineText, loadQaSchedule } from "@/lib/workorder/qaScheduleLoad";
import { melbourneDate } from "@/lib/workorder/console";
import { requestNow } from "@/lib/time/requestClock";
import ColourMatchCard from "@/app/components/wo/ColourMatchCard";
import { humaniseGate } from "@/lib/workorder/gateText";
import TickList from "@/app/components/wo/TickList";
import PhotoGrid from "@/app/components/wo/PhotoGrid";
import { WO_PHOTO_KIND_LABEL, forVariation, groupByKind, officePhotos, signPhotos, type WOPhotoRow } from "@/lib/workorder/photos";
import StageAdvance from "./StageAdvance";
import RebuildTicks from "./RebuildTicks";
import SetDeduction from "./SetDeduction";
import MaterialsCard, { type MaterialRowProp } from "./MaterialsCard";
import FinishLevelCard from "./FinishLevelCard";
import CrewNotesCard from "./CrewNotesCard";
import ClientUpdates, { type ClientTimelineEntry } from "./ClientUpdates";
import ReferencePhotosCard from "./ReferencePhotosCard";
import SiteVisitsCard from "./SiteVisitsCard";
import { loadSiteVisits } from "@/lib/workorder/siteVisits";
import { materialRowKey, substratesFor } from "@/lib/workorder/materials";
import { loadEstimatePricing, materialsBudget, materialsBudgetCents } from "@/lib/workorder/materialsBudget";
import { loadStandards } from "@/lib/standards/load";
import { loadCallbacksForJob } from "@/lib/callbacks/load";
import { CALLBACK_SOURCES, type CallbackSource } from "@/lib/callbacks/model";
import CallbackPanel from "./CallbackPanel";
import NoWorkDay from "./NoWorkDay";
import type { MomentRow } from "@/lib/workorder/reminderMoments";
import { standardsLinksFor } from "@/lib/standards/model";
import RejectVariation from "@/app/pc/RejectVariation";

export const dynamic = "force-dynamic";

const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });

export default async function PcWorkOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ callback?: string }> }) {
  const { id } = await params;
  const { callback: callbackParam } = await searchParams;
  const supabase = await createClient();

  const { data: wo } = await supabase
    .from("work_orders")
    .select("id, wo_ref, stage, blocked_reason, contractor_id, contractor_payment_cents, start_date, end_date, qa_required, qa_waived, walkthrough_required, colours, crew_notes, estimate_id, wo_snapshot, contractors(company_name, profiles(name)), estimates(total_cents, deposit_paid_at:accepted_at)")
    .eq("id", id).maybeSingle();
  if (!wo) notFound();

  const row = wo as unknown as {
    id: string; wo_ref: string; stage: WoStage; blocked_reason: string | null;
    contractor_payment_cents: number | null; start_date: string | null; end_date: string | null;
    qa_required: boolean | null; qa_waived: boolean | null; walkthrough_required: boolean | null;
    colours: Record<string, { status?: string; match?: { code?: string; brand?: string; canSize?: string; by?: string } }> | null;
    crew_notes: string | null;
    wo_snapshot: { jobTitle?: string; jobAddress?: string } | null;
    contractors: { company_name: string | null; profiles: { name: string | null } | null } | null;
    estimates: { total_cents: number | null; deposit_paid_at: string | null } | null;
  };
  // Who's managing the job on site (Tom, 1 Sep #2) — the person, then their company.
  const painterName = (row.contractors?.profiles?.name || row.contractors?.company_name || "").trim();

  const estimateId = (wo as { estimate_id?: string }).estimate_id ?? "";

  // A job parked at qa with every check passed moves itself the moment anyone
  // looks (Tom, 23 Aug — automatic, never a press). Idempotent: anything but a
  // fully-passed qa job answers ok:0; a pack-gate refusal shows in its words.
  let qaHold: string | null = null;
  if (row.stage === "qa") {
    const { data: routed } = await supabase.rpc("wo_qa_route_passed", { p_work_order_id: id });
    const r = String(routed ?? "");
    if (r === "ok:walkthrough") row.stage = "walkthrough";
    else if (r.startsWith("error:gate:")) qaHold = r.slice("error:gate:".length);
  }

  // The office's own lists, built before the reads below so this render sees
  // them (Tom, 18 Sep: "the pre-start checklist has been removed from
  // employees — it still needs to happen for both"). The list is the same for
  // a contractor and an employee; what differed was how many chances it had to
  // be made. 20270173 seeds it at issue and at assignment; this heals a job
  // that predates those triggers, the way the tick list and the QA cadence
  // heal themselves further down. Idempotent — a complete list answers ok:0,
  // and a failure shows as the "list not built" card rather than silence.
  if (row.stage === "offered" || row.stage === "pre_start") {
    await supabase.rpc("wo_seed_checklists", { p_work_order_id: id }).then(() => {}, () => {});
  }

  const [{ data: surfaceRows }, { data: variationRows }, { data: updateRows }, { data: qaRows }, { data: qaLinkRows, error: qaLinkErr }, { data: checklistRows }, { data: rateRow }, { data: walkthroughRows }, { data: signoffRow }] =
    await Promise.all([
      supabase.from("wo_surfaces")
        .select("id, heading, heading_meta, label, state, rectification, removed_from_scope, photos_optional, surface_key")
        .eq("work_order_id", id).order("sort"),
      supabase.from("wo_variations")
        .select("id, category, comment, status, est_hours, price_cents, contractor_delta_cents, released_at, credit, signed_name, signed_at, needs_manual_deduction, deduction_cents, contractor_declined_at, contractor_decline_note, office_rejected_at, office_reject_note")
        .eq("work_order_id", id).order("created_at", { ascending: false }),
      supabase.from("wo_updates").select("id, draft_text, final_text, status, for_date")
        .eq("work_order_id", id).order("for_date", { ascending: false }).limit(1),
      supabase.from("wo_qa_checks")
        .select("id, kind, result, thin_record, scheduled_for, wo_qa_items(id, label, detail, sort, done_at)")
        .eq("work_order_id", id),
      // The re-check link (migration 20270196) on its own, so the QA section
      // survives a stack that has not run it yet: a missing column fails THIS
      // query only, and the links read as "none" — reported, never silent.
      supabase.from("wo_qa_checks").select("id, retry_of").eq("work_order_id", id),
      supabase.from("wo_checklist_items")
        .select("id, phase, label, detail, required, done_at, auto_key, kind, item_key, answer, answer_note, handled_at")
        .eq("work_order_id", id).order("phase").order("sort"),
      // The live contractor rate, so the price preview cannot drift from what
      // the server will actually work out when Tom edits it in Settings.
      supabase.from("settings").select("value").eq("key", "Contractor rate").maybeSingle(),
      supabase.from("wo_walkthroughs")
        .select("id, kind, scheduled_date, status")
        .eq("work_order_id", id).order("created_at", { ascending: true }),
      supabase.from("wo_signoff")
        .select("signed_at, client_unavailable_at, areas")
        .eq("work_order_id", id).maybeSingle(),
    ]);

  // Quality checks with their day and time, the final they sit before, and
  // what reached the calendar (Tom, 8 Oct 2026).
  const qaSchedule = await loadQaSchedule(supabase, id);
  if (qaSchedule.failure) reportError(new Error(qaSchedule.failure), { where: "pc.wo.qaSchedule", bestEffort: true });
  const inviteAt = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  // Call backs (Step 3): every one on the job, the painters who could fix it,
  // the photos on each, whether this staff member may void one, and the areas
  // the customer flagged that nobody has put right (route 2's question).
  const [callbacksLoad, painterRows, ownerRes] = await Promise.all([
    loadCallbacksForJob(supabase, id),
    supabase.from("contractors").select("id, company_name, profiles(name)").eq("active", true).order("company_name"),
    supabase.rpc("has_dashboard_role", { p_roles: ["owner"] }),
  ]);
  if (painterRows.error) reportError(painterRows.error, { where: "pc.wo.painters", bestEffort: true });
  if (ownerRes.error) reportError(ownerRes.error, { where: "pc.wo.ownerRole", bestEffort: true });
  const painters = ((painterRows.error ? [] : painterRows.data ?? []) as unknown as { id: string; company_name: string | null; profiles: { name: string | null } | null }[])
    .map((c) => ({ id: c.id, name: c.profiles?.name || c.company_name || "Painter" }));
  const callbackPhotoRes = callbacksLoad.callbacks.length
    ? await supabase.from("wo_photos").select("id, work_order_id, kind, area, caption, storage_path, created_at, variation_id, callback_id")
        .eq("work_order_id", id).in("callback_id", callbacksLoad.callbacks.map((c) => c.id)).order("created_at", { ascending: true })
    : { data: [], error: null };
  if (callbackPhotoRes.error) reportError(callbackPhotoRes.error, { where: "pc.wo.callbackPhotos", bestEffort: true });
  const callbackPhotos: Record<string, Awaited<ReturnType<typeof signPhotos>>> = {};
  if (!callbackPhotoRes.error) {
    const signed = await signPhotos(supabase, (callbackPhotoRes.data ?? []) as WOPhotoRow[]);
    const byId = new Map(((callbackPhotoRes.data ?? []) as { id: string; callback_id: string | null }[]).map((r) => [r.id, r.callback_id]));
    for (const ph of signed) { const cid = byId.get(ph.id); if (cid) (callbackPhotos[cid] ??= []).push(ph); }
  }
  // Reminder moments (Step 4) and the days the PC marked No work (R10).
  const [momentRes, flagRes] = await Promise.all([
    supabase.from("wo_reminder_moments").select("id, work_order_id, kind, day, due_at, sends_count, last_sent_at, answered_at, skipped_reason").eq("work_order_id", id).order("due_at"),
    supabase.from("wo_day_flags").select("day, reason").eq("work_order_id", id).eq("flag", "no_work").order("day"),
  ]);
  if (momentRes.error) reportError(momentRes.error, { where: "pc.wo.moments", bestEffort: true });
  if (flagRes.error) reportError(flagRes.error, { where: "pc.wo.dayFlags", bestEffort: true });
  const moments: MomentRow[] = ((momentRes.error ? [] : momentRes.data ?? []) as { id: string; work_order_id: string; kind: MomentRow["kind"]; day: string; due_at: string; sends_count: number; last_sent_at: string | null; answered_at: string | null; skipped_reason: MomentRow["skippedReason"] }[])
    .map((m) => ({ id: m.id, workOrderId: m.work_order_id, kind: m.kind, day: m.day, dueAt: m.due_at, sendsCount: m.sends_count, lastSentAt: m.last_sent_at, answeredAt: m.answered_at, skippedReason: m.skipped_reason }));
  const noWorkFlags = (flagRes.error ? [] : flagRes.data ?? []) as { day: string; reason: string }[];
  const signoffAreas = ((signoffRow as { areas?: Record<string, { flagged_at?: string; rectified_at?: string; flag_withdrawn_at?: string }> | null } | null)?.areas) ?? {};
  const flaggedAreas = Object.entries(signoffAreas).filter(([, a]) => a?.flagged_at && !a?.rectified_at && !a?.flag_withdrawn_at).map(([h]) => h);
  const openCallbackSource = (CALLBACK_SOURCES as readonly string[]).includes(callbackParam ?? "") ? (callbackParam as CallbackSource) : null;

  // Derived items answer from the data they read, so the screen and the gate
  // can never disagree about whether a stage is ready.
  // Tick-list self-heal (23 Oakdene, 23 Aug): a job issued before tick seeding
  // existed reached In progress with a job sheet of 80 surfaces and ZERO tick
  // rows — "No tick list on this job yet", and the painter had nothing to tick.
  // Build it on view from the frozen job sheet; idempotent (wo_seed_surfaces
  // keeps what exists). The refetch is a DIFFERENT select shape on purpose:
  // Next memoises identical fetches within a request and would hand back the
  // pre-seed empty list.
  // 87 Trenerry Crescent (1 Oct): two variation rows had landed BEFORE the
  // job was ever opened here, so "no rows at all" was false and the six rooms
  // on the job sheet were never seeded — the painter saw two lines. The test
  // is now "no row that came from the job sheet" (a doc row carries its
  // surface_key; a variation's or a rectification's does not).
  let healedSurfaceRows: typeof surfaceRows = null;
  const snapshotDoc = row.wo_snapshot as WorkOrderDoc | null;
  const docKeys = new Set(snapshotDoc?.areas?.length ? seedRowsFromDoc(snapshotDoc).map((r) => r.surfaceKey).filter(Boolean) : []);
  const hasDocRow = ((surfaceRows ?? []) as Array<{ surface_key?: string | null }>).some((r) => r.surface_key && docKeys.has(r.surface_key));
  if ((row.stage === "pre_start" || row.stage === "in_progress")
      && !hasDocRow && docKeys.size > 0) {
    const { data: seeded } = await supabase.rpc("wo_seed_surfaces", {
      p_work_order_id: id, p_rows: seedRowsFromDoc(snapshotDoc!),
    });
    if (String(seeded ?? "").startsWith("ok:")) {
      const { data: fresh } = await supabase.from("wo_surfaces")
        .select("id, heading, heading_meta, label, state, rectification, sort, photos_optional")
        .eq("work_order_id", id).order("sort");
      healedSurfaceRows = fresh as typeof surfaceRows;
    }
  }
  const liveSurfaceRows = healedSurfaceRows ?? surfaceRows;

  // QA cadence self-heal: wo_schedule_qa was defined and NEVER CALLED anywhere
  // (found 23 Aug — a new contractor's first jobs sailed past quality checks,
  // and a job manually sent to the qa stage arrived to an empty screen).
  // Idempotent by construction: established contractor or already-scheduled
  // job answers ok:0. Best-effort — the page renders regardless.
  if (row.stage === "pre_start" || row.stage === "in_progress") {
    await supabase.rpc("wo_schedule_qa", { p_work_order_id: id }).then(() => {}, () => {});
  }
  // The finishing-up list is part of the tick-off step (Tom, 23 Aug): seed it
  // the moment the job is in progress or parked at the hidden prep stage, so
  // the questions are on screen when the last box is ticked. Idempotent.
  if (row.stage === "in_progress" || row.stage === "completion_prep") {
    await supabase.rpc("wo_seed_prep_checklist", { p_work_order_id: id }).then(() => {}, () => {});
  }

  // The final invoice, once sign-off (or a no-walkthrough close) drafts it —
  // the button to view / edit / resend it lives right on this page (Tom, 1 Sep).
  type FinalInvoice = { id: string; status: string; number: string | null };
  let finalInvoice: FinalInvoice | null = null;
  if (estimateId) {
    const { data: finalRows } = await supabase
      .from("invoices")
      .select("id, status, number")
      .eq("estimate_id", estimateId)
      .eq("kind", "final")
      .neq("status", "void")
      .order("created_at", { ascending: false })
      .limit(1);
    finalInvoice = ((finalRows ?? []) as FinalInvoice[])[0] ?? null;
  }

  const coloursConfirmed = Boolean(
    (await supabase.rpc("wo_colours_confirmed", { p_work_order_id: id })).data,
  );

  // Employed painters (brief §3.4): a job with a crew of employees left, or
  // will leave, stage 1 by ASSIGNMENT — the rail reads "Assigned" and the
  // stage-1 checklist "Ready to assign". A label derived from the rows; the
  // enum never changes. A refused read reads as a contractor job.
  const { data: assignmentRows, error: assignmentErr } = await supabase
    .from("wo_assignments")
    .select("id, start_date, end_date, is_lead, accepted_at, contractors(company_name, profiles(name))")
    .eq("work_order_id", id).neq("status", "released").order("is_lead", { ascending: false }).order("start_date");
  const acceptanceMode: "offered" | "assigned" = !assignmentErr && (assignmentRows ?? []).length > 0 ? "assigned" : "offered";
  // The internal crew list (S5): every painter and their days. The customer's
  // report names the lead only; this page is ours.
  const crew = ((assignmentErr ? [] : assignmentRows ?? []) as unknown as {
    id: string; start_date: string; end_date: string; is_lead: boolean; accepted_at: string | null;
    contractors: { company_name: string | null; profiles: { name: string | null } | null } | null;
  }[]).map((a) => ({
    id: a.id, isLead: a.is_lead, accepted: a.accepted_at !== null, start: a.start_date, end: a.end_date,
    name: a.contractors?.profiles?.name || a.contractors?.company_name || "Painter",
  }));
  const qaScheduled = ((qaRows ?? []) as unknown[]).length > 0;

  // Site check-ins (Tom, 9 Oct 2026; 20270248): Felipe's own visits, with their
  // notes and photos. Never a check — nothing here gates the job.
  const siteVisits = await loadSiteVisits(supabase, id);
  if (siteVisits.failure) reportError(new Error(siteVisits.failure), { where: "pc.wo.siteVisits", bestEffort: true });
  // Who a "Send to the painter" note goes to: the lead painter, else the job's contractor.
  const notePainter = crew.find((c) => c.isLead)?.name ?? (painterName || null);

  // The job sheet, opened on the work-order view where the colours live, and
  // carrying `from` so the builder's top-left link comes back here rather than
  // dumping you on the estimates list.
  const coloursHref = estimateId
    ? `/quote?id=${estimateId}&view=workorder&from=${encodeURIComponent(`/pc/wo/${id}`)}`
    : undefined;

  const checklist = ((checklistRows ?? []) as {
    id: string; phase: string; label: string; detail: string;
    required: boolean; done_at: string | null; auto_key: string | null;
    kind: string | null; item_key: string | null; answer: string | null;
    answer_note: string | null; handled_at: string | null;
  }[]).map((r): ChecklistItem & { phase: string } => ({
    phase: r.phase, id: r.id, label: r.label, detail: r.detail ?? "", required: r.required,
    auto: r.auto_key,
    kind: r.kind === "yes_no" || r.kind === "note" ? r.kind : "tick",
    itemKey: r.item_key,
    answer: r.answer === "yes" || r.answer === "no" ? r.answer : null,
    answerNote: r.answer_note ?? "",
    handled: r.handled_at !== null,
    done: r.auto_key === "colours" ? coloursConfirmed
        : r.auto_key === "qa" ? qaScheduled
        : r.done_at !== null,
  }));

  // Every photo on the job, newest first — the record the painter has been
  // building all along and that nothing on this screen used to show. Signed
  // here (private bucket) and read twice: once for the gallery, once for the
  // before-photo gate, so the office meets the same gate the painter does
  // rather than running a second query to ask the same question.
  const { data: photoRows } = await supabase
    .from("wo_photos")
    .select("id, work_order_id, kind, area, caption, storage_path, created_at, variation_id")
    .eq("work_order_id", id)
    .order("created_at", { ascending: false })
    .limit(120);
  const photos = await signPhotos(supabase, (photoRows as WOPhotoRow[] | null) ?? []);
  // Tom, 30 Sep: the gate is per JOB — any before photo unlocks the list. Asked
  // without the gallery's limit, so an old first photo never falls off the end.
  const { data: gateRows, error: gateError } = await supabase.from("wo_photos").select("kind").eq("work_order_id", id).eq("kind", "before").limit(1);
  const hasBeforePhoto = !gateError && ((gateRows as { kind: string }[] | null) ?? []).length > 0;
  // The finish gate (Step 3) reads the same way; and the office's waiver of it
  // (Tom, 6 Oct, migration 20270215) is an event on the job, never a column.
  const [{ data: afterRows, error: afterError }, { data: waiverRows, error: waiverError }] = await Promise.all([
    supabase.from("wo_photos").select("kind").eq("work_order_id", id).eq("kind", "completion").limit(1),
    supabase.from("wo_events").select("id").eq("work_order_id", id).eq("type", "after_photos_waived").limit(1),
  ]);
  if (afterError) reportError(afterError, { where: "pc.wo.afterPhotoGate", bestEffort: true, extra: { workOrderId: id } });
  if (waiverError) reportError(waiverError, { where: "pc.wo.afterPhotoWaiver", bestEffort: true, extra: { workOrderId: id } });
  const hasAfterPhoto = !afterError && ((afterRows as { kind: string }[] | null) ?? []).length > 0;
  const afterPhotosWaived = !waiverError && ((waiverRows as { id: string }[] | null) ?? []).length > 0;

  // Materials (Tom, 4 Sep): the colour breakdown per substrate off the frozen
  // job sheet, and the budget — the estimate's engine materials cost against
  // every supplier invoice matched to this job. Both reads are tolerant: a
  // fixture without a priced scope shows "—" rather than a fabricated zero.
  const [{ data: materialCostRows }, pricing] = await Promise.all([
    supabase.from("material_costs")
      .select("id, supplier, order_ref, amount_cents, invoice_date, created_at")
      .eq("work_order_id", id)
      .order("invoice_date", { ascending: false, nullsFirst: false }),
    estimateId ? loadEstimatePricing(supabase, estimateId) : Promise.resolve(null),
  ]);
  const materialInvoices = ((materialCostRows ?? []) as {
    id: string; supplier: string; order_ref: string; amount_cents: number; invoice_date: string | null;
  }[]);
  const budget = materialsBudget(
    pricing ? materialsBudgetCents(pricing.state, pricing.ctx) : null,
    materialInvoices,
  );
  const materialRows: MaterialRowProp[] = (snapshotDoc?.materials ?? []).map((m) => {
    const rowKey = materialRowKey(m);
    const live = row.colours?.[rowKey] ?? row.colours?.[m.product];
    return {
      rowKey,
      product: m.product,
      photoUrl: m.photoUrl ?? "",
      colourName: m.colourName ?? "",
      colourHex: m.colourHex ?? "",
      colourStatus: m.colourStatus === "confirmed" || live?.status === "confirmed" ? "confirmed" : "tbc",
      litres: m.litres ?? null,
      coverageMissing: Boolean(m.coverageMissing),
      matchCode: live?.match?.code || m.colourMatch?.code || "",
      matchRequired: Boolean(m.colourMatch?.required),
      finish: m.finish,
      substrates: snapshotDoc ? substratesFor(snapshotDoc, rowKey) : [],
    };
  });

  // A FAIL spawns its re-check (same kind, `retry_of` = the failed check —
  // migration 20270196). The failed card stays as the record; the re-check is
  // the card with controls. Ordered so a re-check sits under what it re-checks.
  if (qaLinkErr) reportError(qaLinkErr, { where: "pc.wo.qaLinks", bestEffort: true, extra: { workOrderId: id } });
  const retryOf = new Map(((qaLinkErr ? [] : qaLinkRows ?? []) as { id: string; retry_of: string | null }[])
    .map((r) => [r.id, r.retry_of] as const));
  const superseded = supersededQaIds([...retryOf].map(([qid, rof]) => ({ id: qid, result: null, retryOf: rof })));
  const qaChecks: QaCheckView[] = ((qaRows ?? []) as unknown as {
    id: string; kind: string; result: string | null; thin_record: boolean;
    wo_qa_items: { id: string; label: string; detail: string; sort: number; done_at: string | null }[] | null;
  }[]).map((c) => ({
    id: c.id, kind: c.kind, result: c.result, thinRecord: c.thin_record,
    retryOf: retryOf.get(c.id) ?? null,
    superseded: superseded.has(c.id),
    standards: [...(c.wo_qa_items ?? [])].sort((a, b) => a.sort - b.sort)
      .map((i) => ({ id: i.id, label: i.label, detail: i.detail, done: i.done_at !== null })),
  }));
  {
    const at = new Map(qaChecks.map((c, i) => [c.id, i]));
    const rootAndDepth = (c: QaCheckView): [number, number] => {
      let cur = c; let depth = 0;
      while (cur.retryOf && at.has(cur.retryOf) && depth < 20) { cur = qaChecks[at.get(cur.retryOf)!]; depth += 1; }
      return [at.get(cur.id) ?? 0, depth];
    };
    qaChecks.sort((a, b) => {
      const [ra, da] = rootAndDepth(a); const [rb, db] = rootAndDepth(b);
      return ra - rb || da - db;
    });
  }
  // Tom, 24 Sep: a job that went through a quality check is the office's to
  // sign off — derived from the checks, same rule as wo_staff_signs_off.
  const staffSignsOff = staffSignsOffFor(qaChecks);
  const todayMelbourne = melbourneDate(requestNow());
  const checkInDue = new Set(qaSchedule.checks
    .filter((c) => c.kind !== "final" && c.result === null && c.date !== null && c.date <= todayMelbourne)
    .map((c) => c.id));

  const forPhase = (phase: string) => checklist.filter((c) => c.phase === phase);
  const outstanding = (phase: string) =>
    forPhase(phase).filter((c) => c.required && !c.done).length;

  // Tom, 8 Oct 2026: the materials / equipment a job needs, written under
  // those two pre-start items and saved before either is ticked.
  const prestart = row.stage === "pre_start" ? await loadPrestartList(supabase, id) : null;
  const prestartExtras: Record<string, ReactNode> = {};
  if (prestart) {
    const pre = forPhase("pre_start");
    const materialsItem = pre.find((c) => /^materials/i.test(c.label));
    const equipmentItem = pre.find((c) => /^equipment/i.test(c.label));
    if (materialsItem) prestartExtras[materialsItem.id] =
      <PrestartListBox workOrderId={id} kind="materials" initial={prestart.list.materials} />;
    if (equipmentItem) prestartExtras[equipmentItem.id] =
      <PrestartListBox workOrderId={id} kind="equipment" initial={prestart.list.equipment} />;
  }

  const contractorRateCents = Math.round(
    Number((rateRow as { value?: { value?: number } } | null)?.value?.value ?? 60) * 100,
  );

  const surfaces = ((liveSurfaceRows ?? []) as {
    id: string; heading: string; heading_meta: string; label: string; surface_key?: string | null;
    state: SurfaceRow["state"]; rectification: boolean; removed_from_scope?: boolean; photos_optional?: boolean | null;
  }[]).map((s) => ({ ...s, removed: s.removed_from_scope ?? false, photosOptional: Boolean(s.photos_optional) }));

  // Finish standards (Step 1, ruling S12): the PC's tick list and quality
  // check link each surface to THE SAME record the painter reads, at the
  // job's level. A refused read is reported by the loader; the links are
  // simply absent here and the standards page itself says why.
  const standardsLoad = await loadStandards();
  const standardsLinks = standardsLoad.standards && snapshotDoc ? standardsLinksFor(standardsLoad.standards, snapshotDoc, "pc", id) : {};
  const expectHref: Record<string, string> = {};
  for (const s of surfaces) if (s.surface_key && standardsLinks[s.surface_key]) expectHref[s.id] = standardsLinks[s.surface_key];
  const qaExpect = (snapshotDoc?.areas ?? []).flatMap((a) => a.surfaces
    .filter((s) => standardsLinks[s.key])
    .map((s) => ({ label: `${a.title} · ${s.label}`, href: standardsLinks[s.key] })));
  const progress = progressOf(surfaces);
  const byHeading = progressByHeading(surfaces);
  const headings = [...new Set(surfaces.map((s) => s.heading))];

  const variations = ((variationRows ?? []) as {
    id: string; category: string; comment: string; status: VariationStatus;
    est_hours: string | null; price_cents: number | null;
    contractor_delta_cents: number | null; released_at: string | null;
    credit: boolean; signed_name: string | null; signed_at: string | null;
    needs_manual_deduction: boolean; deduction_cents: number | null;
    contractor_declined_at?: string | null; contractor_decline_note?: string | null;
    office_rejected_at?: string | null; office_reject_note?: string | null;
  }[]);

  // Tom, 7 Oct 2026 (PC Command item 5): the client-updates timeline — every
  // update that reached the customer and every note the office logged about
  // telling them, newest first. Both reads check their error (a rejected
  // query must never read as "no updates yet").
  const [sentUpdatesRes, clientNotesRes] = await Promise.all([
    supabase.from("wo_updates").select("id, final_text, draft_text, status, for_date, sent_at, approved_at")
      .eq("work_order_id", id).in("status", ["approved", "sent"]).order("for_date", { ascending: false }).limit(40),
    supabase.from("wo_events").select("id, created_at, meta, actor")
      .eq("work_order_id", id).eq("type", "client_update_note").order("created_at", { ascending: false }).limit(80),
  ]);
  // wo_events.actor points at auth.users, not profiles — names are a second, keyed read.
  const noteActorIds = [...new Set(((clientNotesRes.data ?? []) as { actor: string | null }[]).map((e) => e.actor).filter((x): x is string => !!x))];
  const noteActors = noteActorIds.length
    ? await supabase.from("profiles").select("id, name").in("id", noteActorIds)
    : { data: [] as { id: string; name: string | null }[], error: null };
  const actorName = new Map(((noteActors.data ?? []) as { id: string; name: string | null }[]).map((p) => [p.id, p.name]));
  const clientTimelineFailures: string[] = [];
  if (sentUpdatesRes.error) { reportError(sentUpdatesRes.error, { where: "pc.wo.clientUpdates.sent" }); clientTimelineFailures.push("sent updates"); }
  if (clientNotesRes.error) { reportError(clientNotesRes.error, { where: "pc.wo.clientUpdates.notes" }); clientTimelineFailures.push("notes"); }
  const clientTimeline: ClientTimelineEntry[] = [
    ...((sentUpdatesRes.data ?? []) as { id: string; final_text: string | null; draft_text: string; status: string; for_date: string; sent_at: string | null; approved_at: string | null }[])
      .map((u) => ({ id: `u:${u.id}`, kind: u.status === "sent" ? "sent" as const : "approved" as const, at: u.sent_at ?? u.approved_at ?? `${u.for_date}T12:00:00Z`, body: u.final_text ?? u.draft_text, who: null })),
    ...((clientNotesRes.data ?? []) as { id: string; created_at: string; meta: { body?: string } | null; actor: string | null }[])
      .map((e) => ({ id: `n:${e.id}`, kind: "note" as const, at: e.created_at, body: String(e.meta?.body ?? ""), who: (e.actor ? actorName.get(e.actor) : null) ?? null })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const contract = row.estimates?.total_cents ?? 0;
  const contractorPay = row.contractor_payment_cents ?? 0;
  // Signed credits subtract — same signature rule as the ledger (a signed
  // customer approval already counts; the contractor step is pay-side only).
  const approvedVariations = variations
    .filter((v) => v.status === "contractor_accepted" || v.status === "customer_approved")
    .reduce((sum, v) => sum + (v.credit ? -(v.price_cents ?? 0) : (v.price_cents ?? 0)), 0);
  const pendingVariations = variations.some((v) =>
    v.status === "raised" || v.status === "priced" || v.status === "customer_approved");
  // Employed painters (S6): approved labour lines are this job's labour cost —
  // the offer is nil on an employee job, so without them GP reads 100%.
  const { data: labourRows, error: labourError } = await supabase
    .from("job_costs").select("amount_ex_cents, gst_cents")
    .eq("work_order_id", id).eq("category", "labour").in("status", ["approved", "paid"]);
  if (labourError) reportError(labourError, { where: "pc.wo.labourCost", bestEffort: true });
  const labourCents = ((labourRows ?? []) as { amount_ex_cents: number; gst_cents: number }[])
    .reduce((sum, c) => sum + c.amount_ex_cents + c.gst_cents, 0);
  const gp = contract > 0 ? Math.round(((contract - contractorPay - labourCents) / contract) * 1000) / 10 : 0;

  // Dashboard 0c: the job's review row (one per job), for the card below.
  const reviewRes = await supabase.from("review_requests")
    .select("sent_at, sent_via, received_at, rating").eq("work_order_id", id).maybeSingle();
  if (reviewRes.error) reportError(reviewRes.error, { where: "pc.wo.review", bestEffort: true, extra: { workOrderId: id } });
  const reviewRow = reviewRes.data as { sent_at: string | null; sent_via: string | null; received_at: string | null; rating: number | null } | null;
  const reviewState: ReviewState = reviewRow
    ? { sentAt: reviewRow.sent_at, sentVia: reviewRow.sent_via, receivedAt: reviewRow.received_at, rating: reviewRow.rating }
    : null;

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  // The rail's current stop is the LANE, so a job booked weeks out lights
  // 02 Booking confirmed and moves to 03 Pre-start on its own a week before.
  const stageIndex = LANES.indexOf(laneFor(row.stage, row.start_date, today));
  const update = ((updateRows ?? []) as { id: string; draft_text: string; final_text: string | null; status: string; for_date: string }[])[0];

  return (
    <>
      <div className="wohead">
        <div className="wotop">
          <div>
            <h2>{row.wo_snapshot?.jobTitle ?? row.wo_ref}</h2>
            <span className="ref" data-testid="wo-ref">
              {row.wo_ref}{row.wo_snapshot?.jobAddress ? ` · ${row.wo_snapshot.jobAddress}` : ""}
              {painterName ? ` · Painter: ${painterName}` : ""}
            </span>
          </div>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <span className="pill p-cy">PC view</span>
            {/* This screen reads the job; the job sheet itself is edited in the
                builder, and saying so beats hunting for a control that is not
                here on purpose. */}
            <a className="btn" href={`/pc/wo/${id}/as-contractor`} data-testid="as-contractor">
              Painter&rsquo;s view
            </a>
            <a className="btn" href={`/quote?id=${estimateId}&view=workorder&from=${encodeURIComponent(`/pc/wo/${id}`)}`} data-testid="edit-wo">
              Edit job sheet
            </a>
          </span>
        </div>

        <div className="rail7" data-testid="stage-rail">
          {LANES.map((stage, i) => (
            <span className={`st ${i < stageIndex ? "p" : i === stageIndex ? "c" : ""}`} key={stage}
              data-testid={`rail-${stage}`}>
              <i /><span>{LANE_LABELS[stage].n} {stageTitle(stage, acceptanceMode)}</span>
            </span>
          ))}
        </div>

        <div className="money">
          <span className="mi"><span>Contract inc GST</span><b data-testid="money-contract">{money(contract)}</b></span>
          <span className="mi"><span>Variations</span>
            <b style={{ color: pendingVariations ? "var(--amber)" : undefined }} data-testid="money-variations">
              {pendingVariations
                ? "+ pending"
                : approvedVariations > 0
                  ? `+ ${money(approvedVariations)}`
                  : approvedVariations < 0
                    ? `− ${money(Math.abs(approvedVariations))}`
                    : "—"}
            </b>
          </span>
          <span className="mi"><span>Contractor</span><b>{money(contractorPay)}</b></span>
          {labourCents > 0 && (
            <span className="mi"><span>Labour (employees)</span><b data-testid="money-labour">{money(labourCents)}</b></span>
          )}
          <span className="mi"><span>Est. GP</span>
            <b style={{ color: "var(--emerald)" }} data-testid="money-gp">{gp}%</b></span>
          <span className="mi"><span>Deposit</span>
            <b style={{ color: row.estimates?.deposit_paid_at ? "var(--emerald)" : undefined }}>
              {row.estimates?.deposit_paid_at ? "Accepted ✓" : "—"}
            </b>
          </span>
          {/* §7 navigation map: the money strip links to the job's money view,
              and the money view's crumb links back here. The revision builder
              (addendum A2 — measure the change, price it, send for signature)
              is the scope door on every accepted job. */}
          <a className="btn" style={{ marginLeft: "auto" }} href={`/quote?id=${estimateId}&mode=revision`}
            data-testid="revision-builder-link">
            Revise scope →
          </a>
          <a className="btn" href={`/invoicing/job/${estimateId}`}
            data-testid="money-view-link">
            Money view →
          </a>
          {finalInvoice && (
            <a className="btn" href={`/invoicing/inv/${finalInvoice.id}`}
              data-testid="final-invoice-link"
              title="View, edit or resend the final invoice">
              Final invoice{finalInvoice.status === "draft" ? " (draft)" : finalInvoice.number ? ` ${finalInvoice.number}` : ""} →
            </a>
          )}
        </div>
      </div>

      {row.blocked_reason && (
        <div className="blocker" data-testid="blocker">
          <span aria-hidden="true">⚑</span>
          <div>
            <b>{row.blocked_reason}</b>
            <p>Everything else on this job is running.</p>
          </div>
        </div>
      )}

      {/* Tom, 4 Oct: what the estimator wrote or said about this job — internal,
          staff only, loaded client-side so no note text sits in this page's HTML. */}
      {estimateId && <EstimatorNotes estimateId={estimateId} surface="console" who="the project coordinator" />}

      <div className="grid2">
        {row.stage === "in_progress" ? (
          <TickList
            expectHref={expectHref}
            surfaces={surfaces.map((s) => ({
              id: s.id, heading: s.heading, label: s.label, state: s.state,
              rectification: s.rectification, removed: s.removed, photosOptional: s.photosOptional,
            }))}
            hasBeforePhoto={hasBeforePhoto}
            headingMeta={Object.fromEntries(
              surfaces.map((s) => [s.heading, s.heading_meta]).filter(([, m]) => m),
            )}
            surface="console"
            canWaivePhotos
          />
        ) : (
          <div className="card">
            <h3>Scope &amp; ticks <em data-testid="tick-count">{progress.done} / {progress.total}</em></h3>
            <div className="prog"><i style={{ width: `${progress.pct}%` }} /></div>

            {headings.map((heading) => {
              const p = byHeading.get(heading);
              const meta = surfaces.find((s) => s.heading === heading)?.heading_meta ?? "";
              return (
                <div className="elev" key={heading}>
                  <div className="eh">
                    <b>{heading}</b>
                    {meta && <em>{meta}</em>}
                    <span className="ct">{p ? `${p.done}/${p.total}` : ""}{p && p.done === p.total ? " ✓" : ""}</span>
                  </div>
                  {surfaces.filter((s) => s.heading === heading).map((s) => (
                    <div className="tick" key={s.id} style={s.removed ? { opacity: 0.55 } : undefined}>
                      <span className="sw" aria-hidden="true">
                        <i className={s.state !== "todo" ? "a" : ""} />
                        <i className={s.state === "done" ? "a" : s.state === "prepped" ? "b" : ""} />
                        <i className={s.state === "done" ? "a" : ""} />
                      </span>
                      <p style={s.removed ? { textDecoration: "line-through" } : undefined}>
                        {s.label}
                        {s.photosOptional && <span className="pill" style={{ marginLeft: 6 }} data-testid={`no-photos-${s.id}`}>No photos</span>}
                      </p>
                      {/* Tom, 24 Sep: a line that isn't a surface need not be
                          photographed — set it here before the job starts. */}
                      {!s.removed && row.stage !== "closed" && (
                        <PhotosOptionalToggle surfaceId={s.id} label={s.label} optional={s.photosOptional} />
                      )}
                      <span className={`pill ${s.removed ? "p-amber" : s.state === "done" ? "p-em" : s.state === "prepped" ? "p-cy" : s.rectification ? "p-amber" : ""}`}>
                        {s.removed ? "Removed from scope" : s.rectification && s.state !== "done" ? "Rectify" : s.state === "done" ? "Done" : s.state === "prepped" ? "Prepped" : "To do"}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}

            {surfaces.length === 0 && (
              <p className="note">
                No tick list yet. Jobs issued before the tick list existed have none —
                build it from the job sheet and the painter can start ticking.
              </p>
            )}
            <RebuildTicks workOrderId={id} empty={surfaces.length === 0} />
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <StageAdvance
            workOrderId={id}
            stage={row.stage}
            startDate={row.start_date}
            today={today}
            walkthroughRequired={row.walkthrough_required !== false}
            staffSignsOff={staffSignsOff}
            readiness={row.stage === "in_progress" || row.stage === "completion_prep" ? {
              surfacesLeft: progress.total - progress.done,
              surfacesTotal: progress.total,
              needsAfterPhotos: jobNeedsAfterPhotos(surfaces, hasAfterPhoto),
              afterPhotosWaived,
              prepLeft: outstanding("completion_prep"),
              variationsWaiting: variations.filter((v) => v.status === "raised" || v.status === "priced" || v.status === "customer_approved").length,
              areas: headings,
            } : null}
          />

          {/* Further instructions for the crew (Tom, 8 Oct): the builder's
              work-order note, written here too. work_orders.crew_notes is the
              one place it lives; the issued sheet follows it (20270244). A
              blank column shows what the sheet already says rather than an
              empty box over a sheet that carries a note. */}
          <CrewNotesCard
            workOrderId={id}
            notes={(row.crew_notes ?? "") || (snapshotDoc?.crewNotes ?? "")}
            sheetNotes={snapshotDoc && (row.crew_notes ?? "") !== ""
              && (snapshotDoc.crewNotes ?? "") !== (row.crew_notes ?? "")
              ? (snapshotDoc.crewNotes ?? "") : null}
            canEdit={row.stage !== "closed"}
          />

          {/* Colour matches (Tom, 23 Aug): flagged by the estimator or opened by
              a "No" on the colours question — codes come from the estimate or
              the painter, and the hand-over is gated until they're in. */}
          <ColourMatchCard
            workOrderId={id}
            materials={(snapshotDoc?.materials ?? []).map((m) => ({
              product: m.product, colourName: m.colourName,
              required: Boolean(m.colourMatch?.required),
              snapCode: m.colourMatch?.code ?? "", snapBrand: m.colourMatch?.brand ?? "", snapCan: m.colourMatch?.canSize ?? "",
              woMatch: row.colours?.[m.product]?.match ?? null,
            }))}
            coloursNo={checklist.some((c) => c.phase === "pre_start" && c.itemKey === "colours" && c.answer === "no")}
            canEdit={row.stage !== "closed"}
          />

          {/* Photos for the painter (Tom, 23 Sep): a handover job's estimate
              carries none and the sheet's own photos froze at acceptance, so
              without this there is nothing to show them. Hidden once closed —
              a closed job's sheet is final. */}
          {row.stage !== "closed" && (
            <ReferencePhotosCard
              workOrderId={id}
              areas={(snapshotDoc?.areas ?? []).map((a) => a.title).filter(Boolean)}
              photos={officePhotos(photos)}
            />
          )}

          {/* Level of finish (Tom, 23 Sep): the job sheet's standard is frozen
              at issue and the revision builder cannot reach it — this is the
              only door from "we agreed Level 2" to what the painter is held to.
              Document only; the money rides the variation. */}
          {snapshotDoc && row.stage !== "closed" && (
            <FinishLevelCard
              workOrderId={id}
              finishCode={snapshotDoc.finishCode ?? null}
              levelOfFinish={snapshotDoc.levelOfFinish ?? ""}
              overriddenAreas={(snapshotDoc.areas ?? [])
                .filter((a) => a.finishOverridden)
                .map((a) => a.title)}
            />
          )}

          {/* Materials (Tom, 4 Sep): colours per substrate, adjustable here,
              and the budget against matched supplier invoices. */}
          <MaterialsCard
            workOrderId={id}
            rows={materialRows}
            budget={{
              ...budget,
              invoices: materialInvoices.map((inv) => ({
                id: inv.id, supplier: inv.supplier, amountCents: inv.amount_cents,
                date: inv.invoice_date, ref: inv.order_ref,
              })),
            }}
            canEdit={row.stage !== "closed"}
            moneyHref={`/invoicing/job/${estimateId}?tab=costs`}
          />

          {crew.length > 0 && (
            <div className="card" data-testid="crew-card">
              <div className="tick-head"><b>Crew</b><span className="tick-count">{crew.length} painter{crew.length === 1 ? "" : "s"}</span></div>
              {crew.map((c) => (
                <div key={c.id} className="frow" data-testid={`crew-${c.id}`}>
                  <span className="l">{c.isLead ? "★ Lead" : "Painter"}</span>
                  <span className="v">
                    {c.name.toUpperCase()} · {c.start === c.end ? c.start : `${c.start} → ${c.end}`}
                    {c.accepted ? "" : " · NOT YET SEEN"}
                  </span>
                </div>
              ))}
              <p className="hint" style={{ padding: 0, marginTop: 6 }}>The customer hears about the lead painter only. Change the lead from the schedule board.</p>
            </div>
          )}

          {row.stage === "offered" && forPhase("pre_offer").length > 0 && (
            <Checklist
              title={acceptanceMode === "assigned" ? "Ready to assign" : "Ready to offer"}
              caption="Not ready to start — colours can still be TBC when the contractor accepts."
              items={forPhase("pre_offer")}
              outstanding={outstanding("pre_offer")}
              coloursHref={coloursHref}
            />
          )}

          {row.stage === "pre_start" && forPhase("pre_start").length > 0 && (
            <Checklist
              title="Pre-start"
              caption="Everything the site needs, arranged before day one. The job cannot start until these are true."
              items={forPhase("pre_start")}
              outstanding={outstanding("pre_start")}
              coloursHref={coloursHref}
              extras={prestartExtras}
            />
          )}
          {prestart?.failure && (
            <p className="note" style={{ color: "var(--amber)" }} data-testid="prestart-list-failure">{prestart.failure}</p>
          )}

          {/* A job at pre-start with no list is a fault, not a finished list —
              and drawing nothing is how it stayed invisible. The seed above
              runs on every view, so this says the heal itself failed. */}
          {row.stage === "pre_start" && forPhase("pre_start").length === 0 && (
            <div className="card" data-testid="pre-start-missing">
              <h3>Pre-start <em>list not built</em></h3>
              <p className="note">
                This job has no pre-start list — colours, materials, equipment and access.
                It should build itself the moment the job is issued or a painter is put on it,
                for a contractor and an employee alike. Refresh once; if it is still empty,
                the job cannot start and the office needs to know.
              </p>
            </div>
          )}

          {/* §4b: book the walkthroughs and hold the Mode B gate. Shown from
              PRE-START (Tom, 23 Aug): the walkthrough is booked WITH the client
              at the start of the process — usually while booking the job in —
              not remembered at the end. Blank date still means last day on
              site, so an early booking follows the schedule automatically. */}
          {/* Tom, 24 Sep: from the OFFER too — "walkthrough not required" is a
              decision the office may take the moment the job is approved. */}
          {(row.stage === "offered" || row.stage === "pre_start" || row.stage === "in_progress" || row.stage === "qa"
            || row.stage === "completion_prep" || row.stage === "walkthrough") && (
            <WalkthroughCard
              workOrderId={id}
              walkthroughs={((walkthroughRows ?? []) as { id: string; kind: string; scheduled_date: string; status: string }[])
                .map((w) => ({ id: w.id, kind: w.kind, scheduledDate: w.scheduled_date, status: w.status }))}
              clientUnavailable={Boolean((signoffRow as { client_unavailable_at?: string | null } | null)?.client_unavailable_at)}
              signedAt={(signoffRow as { signed_at?: string | null } | null)?.signed_at ?? null}
              startDate={row.start_date}
              endDate={row.end_date}
              stage={row.stage}
              walkthroughRequired={row.walkthrough_required !== false}
              staffSignsOff={staffSignsOff}
            />
          )}

          {/* The finishing-up list, shown WITH the ticks once they're done —
              completion prep is not a stage anyone sees any more. */}
          {(row.stage === "completion_prep"
            || (row.stage === "in_progress" && progress.done === progress.total && progress.total > 0))
            && forPhase("completion_prep").length > 0 && (
            <Checklist
              title="Finishing up"
              caption="The last pass before the customer walks through — part of ticking off. A yes on rubbish or equipment puts a prompt on the dashboard."
              items={forPhase("completion_prep")}
              outstanding={outstanding("completion_prep")}
              footer="Ticking this list is the painter's confirmation that the work has been completed to the scope and standard on the job sheet."
            />
          )}

          {/* The checks stay on screen past the pass (walkthrough, closed):
              the last PASS sends the pack and refreshes this page — the card
              must survive that, or its "pack sent" message vanishes with it.
              Same for a FAIL, which sends the job back to In progress: the
              logged record (and where its re-check went) stays in view while
              the painter rectifies; the unlogged re-check itself waits for
              their next finish before it is drawn. */}
          {/* Tom, 8 Oct 2026: a mid-job or spot check whose day has come is
              recorded while the job is still running — its PC Command card
              ("Record the check") lands here. Site check-ins are NOT checks
              (9 Oct): they have their own card just below. */}
          <div id="qa">
            {(row.stage === "qa" || row.stage === "walkthrough" || row.stage === "closed" || row.stage === "in_progress")
              && qaChecks.filter((c) => row.stage !== "in_progress" || c.result !== null || checkInDue.has(c.id)).map((c) => (
              <QaCheck key={c.id} check={c} workOrderId={id} expect={qaExpect} />
            ))}
          </div>
          <SiteVisitsCard visits={siteVisits.visits} painter={notePainter} closed={row.stage === "closed"} failure={siteVisits.failure} />
          {/* Dashboard 0c: reviews requested → received, a person's tick until the API. */}
          {(row.stage === "walkthrough" || row.stage === "closed") && (
            <ReviewCard workOrderId={id} review={reviewState} />
          )}
          {/* An empty qa stage was a silent dead end: no cards, no explanation,
              and the way forward not obviously the answer. Say what's true. */}
          {row.stage === "qa" && qaHold && (
            <div className="card" data-testid="qa-hold">
              <h3>Quality check <em>passed — handover waiting</em></h3>
              <p className="note">
                Every check has passed, but the customer can&rsquo;t be asked to look yet: {humaniseGate(qaHold)}.
                Clear that and the job moves to Walkthrough on its own.
              </p>
            </div>
          )}
          {row.stage === "qa" && qaChecks.length === 0 && (
            <div className="card" data-testid="qa-none">
              <h3>Quality check <em>none due</em></h3>
              <p className="note">
                No checks are scheduled on this job — the cadence only creates them
                for a contractor&rsquo;s first few jobs. Use{" "}
                <b>Move to completion prep</b> above to continue.
              </p>
            </div>
          )}

          {(row.stage === "pre_start" || row.stage === "in_progress" || row.stage === "completion_prep" || moments.length > 0) && (
            <NoWorkDay workOrderId={id} moments={moments} flags={noWorkFlags} />
          )}

          {callbacksLoad.error ? (
            <div className="card" data-testid="callbacks-unavailable"><h3>Call backs</h3><p className="note" style={{ color: "var(--amber)" }}>{callbacksLoad.error}</p></div>
          ) : (
            <CallbackPanel workOrderId={id} callbacks={callbacksLoad.callbacks} painters={painters}
              jobPainterId={(wo as { contractor_id?: string | null }).contractor_id ?? null}
              canVoid={!ownerRes.error && Boolean(ownerRes.data)} photos={callbackPhotos} flaggedAreas={flaggedAreas} openSource={openCallbackSource} />
          )}

          {variations.map((v) => (
            <div className="card" key={v.id} id={`variation-${v.id}`} data-testid={`variation-${v.id}`}>
              <h3>Variation <em>{v.status.replace(/_/g, " ")}</em></h3>
              <div className="vsteps">
                {VARIATION_STEPS.map((label, i) => {
                  const at = stepIndex(v.status);
                  return (
                    <span className={`vs ${i < at ? "hit" : i === at ? "now" : ""}`} key={label}>
                      <i /><span>{label}</span>
                    </span>
                  );
                })}
              </div>
              <div className="draft">
                &ldquo;{v.comment}&rdquo; <b>— {v.category.replace(/_/g, " ")}
                {v.est_hours ? ` · est. ${Number(v.est_hours)} hrs` : ""}
                {v.credit ? " · credit" : ""}</b>
              </div>
              {v.signed_name && (
                <p className="note" data-testid={`variation-signed-${v.id}`}>
                  ✓ Signed by {v.signed_name}
                  {v.signed_at
                    ? ` on ${new Date(v.signed_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`
                    : ""}
                </p>
              )}
              {/* Tom, 7 Oct 2026: the client approved it; the painter declined it, with a note. */}
              {v.status === "declined" && v.contractor_declined_at && (
                <p className="note" data-testid={`variation-painter-declined-${v.id}`} style={{ color: "var(--clay, #c2410c)" }}>
                  Declined by the painter{v.contractor_declined_at ? ` on ${new Date(v.contractor_declined_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}` : ""} after the client approved it
                  {v.contractor_decline_note ? <> — they wrote: &ldquo;{v.contractor_decline_note}&rdquo;</> : "."} Revise it with the client in <b>Revise scope</b>, or set the painter&rsquo;s amount and re-send.
                </p>
              )}
              {/* Tom, 8 Oct 2026: the office turned it down, with a reply to the painter. */}
              {v.status === "declined" && v.office_rejected_at && (
                <p className="note" data-testid={`variation-office-rejected-${v.id}`} style={{ color: "var(--clay, #c2410c)" }}>
                  Rejected by the office on {new Date(v.office_rejected_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" })}
                  {v.office_reject_note ? <> — the reply to the painter: &ldquo;{v.office_reject_note}&rdquo;</> : "."}
                </p>
              )}
              {v.status === "raised" && <RejectVariation variationId={v.id} />}
              {/* What the painter photographed when they raised it — pricing a
                  variation off a one-line comment was guesswork. */}
              <PhotoGrid
                photos={forVariation(photos, v.id)}
                tight
                showKind={false}
                empty="No photo was attached to this variation."
              />
              {/* Credits don't travel the release→accept path: the contractor
                  ACKNOWLEDGES (or the PC sets the manual deduction). */}
              {!v.credit && (
                <PriceVariation
                  id={v.id}
                  estimateId={estimateId}
                  status={v.status}
                  released={v.released_at !== null}
                  estHours={v.est_hours === null ? null : Number(v.est_hours)}
                  priceCents={v.price_cents}
                  deltaCents={v.contractor_delta_cents}
                  rateCents={contractorRateCents}
                />
              )}
              {v.credit && v.needs_manual_deduction && v.deduction_cents === null
                && (v.status === "customer_approved" || v.status === "contractor_accepted") && (
                <SetDeduction id={v.id} startedSurfaces={null} creditCents={v.price_cents} />
              )}
              {v.credit && v.deduction_cents !== null && (
                <p className="note" data-testid={`deduction-set-${v.id}`}>
                  Pay deduction set: −{money(v.deduction_cents)}.
                </p>
              )}
              {v.credit && !v.needs_manual_deduction && v.status === "customer_approved" && (
                <p className="note">Waiting on the contractor to acknowledge the removal.</p>
              )}
            </div>
          ))}

          {/* Push an update to the client from RIGHT HERE (Tom, 25 Aug) —
              prefilled with the sweep's draft when one is waiting. */}
          <UpdateComposer
            workOrderId={id}
            draftText={update?.status === "drafted" ? (update.final_text ?? update.draft_text) : ""}
            photos={photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption ?? "" }))}
          />
          {update && update.status !== "drafted" && (
            <div className="card" data-testid="latest-update">
              <h3>Latest update <em>{update.status}</em></h3>
              <div className="draft">{update.final_text ?? update.draft_text}</div>
            </div>
          )}

          {/* Tom, 7 Oct 2026: a notes box for what the client was told (a call, a
              text, a conversation on site) — on this job's timeline AND on the
              customer's CRM record. */}
          <ClientUpdates workOrderId={id} entries={clientTimeline} failures={clientTimelineFailures} />

          <div className="card" data-testid="site-photos">
            <h3>From site <em data-testid="photo-count">{photos.length} photo{photos.length === 1 ? "" : "s"}</em></h3>
            {photos.length === 0 ? (
              <p className="note">
                Nothing sent in yet. The painter&rsquo;s before photos arrive as Step 1
                of the job; progress, quality-check and after photos follow.
              </p>
            ) : (
              groupByKind(photos).map((g) => (
                <div className="photoset" key={g.kind}>
                  <div className="photoset-h">
                    <b>{WO_PHOTO_KIND_LABEL[g.kind]}</b>
                    <span className="pill">{g.photos.length}</span>
                  </div>
                  <PhotoGrid photos={g.photos} tight showKind={false} />
                </div>
              ))
            )}
          </div>

          <div className="card">
            <h3>Job facts</h3>
            <div className="tick"><p>Start date</p><span className="pill">{row.start_date ?? "TBC"}</span></div>
            <div className="tick"><p>Quality checks</p>
              <span className={`pill ${(qaRows ?? []).length === 0 ? "" : "p-cy"}`} data-testid="qa-facts-pill">
                {row.qa_waived ? "Not required — waived by the office"
                  : (qaRows ?? []).length === 0 ? "Not required — established" : `${(qaRows ?? []).length} scheduled`}
              </span>
            </div>
            {qaSchedule.failure && <p className="note" style={{ color: "var(--amber)" }} data-testid="qa-schedule-failure">{qaSchedule.failure}</p>}
            <QaSchedule
              rows={qaSchedule.checks.map((q) => ({
                id: q.id, label: qaCheckLabel(q.kind), recheck: Boolean(retryOf.get(q.id)), result: q.result,
                superseded: superseded.has(q.id), thinRecord: q.thinRecord, date: q.date, time: q.time,
                suggested: q.kind === "final" && !retryOf.get(q.id) && qaSchedule.final ? defaultQaWhen(qaSchedule.final.date, qaSchedule.holidays) : null,
                invite: inviteLineText(qaSchedule.invites.get(q.id), inviteAt),
              }))}
              final={qaSchedule.final} today={todayMelbourne} closed={row.stage === "closed"} />
            <QaControls workOrderId={id} qaRequired={Boolean(row.qa_required)} qaWaived={Boolean(row.qa_waived)}
              scheduledCount={(qaRows ?? []).length} closed={row.stage === "closed"} />
          </div>
        </div>
      </div>
    </>
  );
}
