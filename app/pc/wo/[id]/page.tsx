import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { STAGE_LANES, WO_STAGES, type WoStage, VISIBLE_STAGES, visibleStage } from "@/lib/workorder/stages";
import { progressByHeading, progressOf, seedRowsFromDoc, type SurfaceRow } from "@/lib/workorder/surfaces";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";
import { VARIATION_STEPS, stepIndex, type VariationStatus } from "@/lib/workorder/variations";
import PriceVariation from "./PriceVariation";
import Checklist, { type ChecklistItem } from "./Checklist";
import WalkthroughCard from "./WalkthroughCard";
import QaCheck, { type QaCheckView } from "./QaCheck";
import QaControls from "./QaControls";
import ColourMatchCard from "@/app/components/wo/ColourMatchCard";
import { humaniseGate } from "@/lib/workorder/gateText";
import TickList from "@/app/components/wo/TickList";
import PhotoGrid from "@/app/components/wo/PhotoGrid";
import { WO_PHOTO_KIND_LABEL, forVariation, groupByKind, signPhotos, type WOPhotoRow } from "@/lib/workorder/photos";
import StageAdvance from "./StageAdvance";
import RebuildTicks from "./RebuildTicks";
import SetDeduction from "./SetDeduction";

export const dynamic = "force-dynamic";

const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });

export default async function PcWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: wo } = await supabase
    .from("work_orders")
    .select("id, wo_ref, stage, blocked_reason, contractor_payment_cents, start_date, end_date, qa_required, walkthrough_required, colours, estimate_id, wo_snapshot, estimates(total_cents, deposit_paid_at:accepted_at)")
    .eq("id", id).maybeSingle();
  if (!wo) notFound();

  const row = wo as unknown as {
    id: string; wo_ref: string; stage: WoStage; blocked_reason: string | null;
    contractor_payment_cents: number | null; start_date: string | null; end_date: string | null;
    qa_required: boolean | null; walkthrough_required: boolean | null;
    colours: Record<string, { status?: string; match?: { code?: string; brand?: string; canSize?: string; by?: string } }> | null;
    wo_snapshot: { jobTitle?: string; jobAddress?: string } | null;
    estimates: { total_cents: number | null; deposit_paid_at: string | null } | null;
  };

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

  const [{ data: surfaceRows }, { data: variationRows }, { data: updateRows }, { data: qaRows }, { data: checklistRows }, { data: rateRow }, { data: walkthroughRows }, { data: signoffRow }] =
    await Promise.all([
      supabase.from("wo_surfaces")
        .select("id, heading, heading_meta, label, state, rectification, removed_from_scope")
        .eq("work_order_id", id).order("sort"),
      supabase.from("wo_variations")
        .select("id, category, comment, status, est_hours, price_cents, contractor_delta_cents, released_at, credit, signed_name, signed_at, needs_manual_deduction, deduction_cents")
        .eq("work_order_id", id).order("created_at", { ascending: false }),
      supabase.from("wo_updates").select("id, draft_text, final_text, status, for_date")
        .eq("work_order_id", id).order("for_date", { ascending: false }).limit(1),
      supabase.from("wo_qa_checks")
        .select("id, kind, result, thin_record, scheduled_for, wo_qa_items(id, label, detail, sort, done_at)")
        .eq("work_order_id", id),
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
        .select("signed_at, client_unavailable_at")
        .eq("work_order_id", id).maybeSingle(),
    ]);

  // Derived items answer from the data they read, so the screen and the gate
  // can never disagree about whether a stage is ready.
  // Tick-list self-heal (23 Oakdene, 23 Aug): a job issued before tick seeding
  // existed reached In progress with a job sheet of 80 surfaces and ZERO tick
  // rows — "No tick list on this job yet", and the painter had nothing to tick.
  // Build it on view from the frozen job sheet; idempotent (wo_seed_surfaces
  // keeps what exists). The refetch is a DIFFERENT select shape on purpose:
  // Next memoises identical fetches within a request and would hand back the
  // pre-seed empty list.
  let healedSurfaceRows: typeof surfaceRows = null;
  const snapshotDoc = row.wo_snapshot as WorkOrderDoc | null;
  if ((row.stage === "pre_start" || row.stage === "in_progress")
      && (surfaceRows ?? []).length === 0 && (snapshotDoc?.areas?.length ?? 0) > 0) {
    const { data: seeded } = await supabase.rpc("wo_seed_surfaces", {
      p_work_order_id: id, p_rows: seedRowsFromDoc(snapshotDoc!),
    });
    if (String(seeded ?? "").startsWith("ok:")) {
      const { data: fresh } = await supabase.from("wo_surfaces")
        .select("id, heading, heading_meta, label, state, rectification, sort")
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

  const coloursConfirmed = Boolean(
    (await supabase.rpc("wo_colours_confirmed", { p_work_order_id: id })).data,
  );
  const qaScheduled = ((qaRows ?? []) as unknown[]).length > 0;

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
  const headingsWithBeforePhoto = [...new Set(
    ((photoRows as WOPhotoRow[] | null) ?? [])
      .filter((p) => p.kind === "before").map((p) => p.area ?? "").filter(Boolean),
  )];
  // Without this the finished-photo prompt would keep asking for shots that
  // are already in — the prop defaults to "none logged".
  const headingsWithAfterPhoto = [...new Set(
    ((photoRows as WOPhotoRow[] | null) ?? [])
      .filter((p) => p.kind === "completion").map((p) => p.area ?? "").filter(Boolean),
  )];

  const qaChecks: QaCheckView[] = ((qaRows ?? []) as unknown as {
    id: string; kind: string; result: string | null; thin_record: boolean;
    wo_qa_items: { id: string; label: string; detail: string; sort: number; done_at: string | null }[] | null;
  }[]).map((c) => ({
    id: c.id, kind: c.kind, result: c.result, thinRecord: c.thin_record,
    standards: [...(c.wo_qa_items ?? [])].sort((a, b) => a.sort - b.sort)
      .map((i) => ({ id: i.id, label: i.label, detail: i.detail, done: i.done_at !== null })),
  }));

  const forPhase = (phase: string) => checklist.filter((c) => c.phase === phase);
  const outstanding = (phase: string) =>
    forPhase(phase).filter((c) => c.required && !c.done).length;

  const contractorRateCents = Math.round(
    Number((rateRow as { value?: { value?: number } } | null)?.value?.value ?? 60) * 100,
  );

  const surfaces = ((liveSurfaceRows ?? []) as {
    id: string; heading: string; heading_meta: string; label: string;
    state: SurfaceRow["state"]; rectification: boolean; removed_from_scope?: boolean;
  }[]).map((s) => ({ ...s, removed: s.removed_from_scope ?? false }));
  const progress = progressOf(surfaces);
  const byHeading = progressByHeading(surfaces);
  const headings = [...new Set(surfaces.map((s) => s.heading))];

  const variations = ((variationRows ?? []) as {
    id: string; category: string; comment: string; status: VariationStatus;
    est_hours: string | null; price_cents: number | null;
    contractor_delta_cents: number | null; released_at: string | null;
    credit: boolean; signed_name: string | null; signed_at: string | null;
    needs_manual_deduction: boolean; deduction_cents: number | null;
  }[]);

  const contract = row.estimates?.total_cents ?? 0;
  const contractorPay = row.contractor_payment_cents ?? 0;
  // Signed credits subtract — same signature rule as the ledger (a signed
  // customer approval already counts; the contractor step is pay-side only).
  const approvedVariations = variations
    .filter((v) => v.status === "contractor_accepted" || v.status === "customer_approved")
    .reduce((sum, v) => sum + (v.credit ? -(v.price_cents ?? 0) : (v.price_cents ?? 0)), 0);
  const pendingVariations = variations.some((v) =>
    v.status === "raised" || v.status === "priced" || v.status === "customer_approved");
  const gp = contract > 0 ? Math.round(((contract - contractorPay) / contract) * 1000) / 10 : 0;

  const stageIndex = VISIBLE_STAGES.indexOf(visibleStage(row.stage));
  const update = ((updateRows ?? []) as { id: string; draft_text: string; final_text: string | null; status: string; for_date: string }[])[0];

  return (
    <>
      <div className="wohead">
        <div className="wotop">
          <div>
            <h2>{row.wo_snapshot?.jobTitle ?? row.wo_ref}</h2>
            <span className="ref" data-testid="wo-ref">
              {row.wo_ref}{row.wo_snapshot?.jobAddress ? ` · ${row.wo_snapshot.jobAddress}` : ""}
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
          {VISIBLE_STAGES.map((stage, i) => (
            <span className={`st ${i < stageIndex ? "p" : i === stageIndex ? "c" : ""}`} key={stage}
              data-testid={`rail-${stage}`}>
              <i /><span>{STAGE_LANES[stage].n} {STAGE_LANES[stage].title}</span>
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
          <span className="mi"><span>Est. GP</span>
            <b style={{ color: "var(--emerald)" }} data-testid="money-gp">{gp}%</b></span>
          <span className="mi"><span>Deposit</span>
            <b style={{ color: row.estimates?.deposit_paid_at ? "var(--emerald)" : undefined }}>
              {row.estimates?.deposit_paid_at ? "Accepted ✓" : "—"}
            </b>
          </span>
          {/* §7 navigation map: the money strip links to the job's money view,
              and the money view's crumb links back here. */}
          <a className="btn" style={{ marginLeft: "auto" }} href={`/invoicing/job/${estimateId}`}
            data-testid="money-view-link">
            Money view →
          </a>
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

      <div className="grid2">
        {row.stage === "in_progress" ? (
          <TickList
            workOrderId={id}
            surfaces={surfaces.map((s) => ({
              id: s.id, heading: s.heading, label: s.label, state: s.state,
              rectification: s.rectification, removed: s.removed,
            }))}
            headingsWithBeforePhoto={headingsWithBeforePhoto}
            headingsWithAfterPhoto={headingsWithAfterPhoto}
            headingMeta={Object.fromEntries(
              surfaces.map((s) => [s.heading, s.heading_meta]).filter(([, m]) => m),
            )}
            surface="console"
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
                      <p style={s.removed ? { textDecoration: "line-through" } : undefined}>{s.label}</p>
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
            today={new Intl.DateTimeFormat("en-CA", {
              timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
            }).format(new Date())}
            walkthroughRequired={row.walkthrough_required !== false}
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

          {row.stage === "offered" && forPhase("pre_offer").length > 0 && (
            <Checklist
              title="Ready to offer"
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
            />
          )}

          {/* §4b: book the walkthroughs and hold the Mode B gate. Shown from
              PRE-START (Tom, 23 Aug): the walkthrough is booked WITH the client
              at the start of the process — usually while booking the job in —
              not remembered at the end. Blank date still means last day on
              site, so an early booking follows the schedule automatically. */}
          {(row.stage === "pre_start" || row.stage === "in_progress" || row.stage === "qa"
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
              must survive that, or its "pack sent" message vanishes with it. */}
          {(row.stage === "qa" || row.stage === "walkthrough" || row.stage === "closed") && qaChecks.map((c) => (
            <QaCheck key={c.id} check={c} />
          ))}
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

          {update && (
            <div className="card" data-testid="latest-update">
              <h3>Latest update <em>{update.status}</em></h3>
              <div className="draft">{update.final_text ?? update.draft_text}</div>
              {update.status === "drafted" && (
                <p className="note">Waiting on you — review it on the Updates tab.</p>
              )}
            </div>
          )}

          <div className="card" data-testid="site-photos">
            <h3>From site <em data-testid="photo-count">{photos.length} photo{photos.length === 1 ? "" : "s"}</em></h3>
            {photos.length === 0 ? (
              <p className="note">
                Nothing sent in yet. Before-photos arrive with the first tick on
                each elevation; progress, quality-check and completion photos follow.
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
              <span className={`pill ${(qaRows ?? []).length === 0 ? "" : "p-cy"}`}>
                {(qaRows ?? []).length === 0 ? "Not required — established" : `${(qaRows ?? []).length} scheduled`}
              </span>
            </div>
            {((qaRows ?? []) as { id: string; kind: string; result: string | null; thin_record: boolean; scheduled_for: string | null }[]).map((q) => (
              <div className="tick" key={q.id}>
                <p>{q.kind === "mid" ? "mid-job" : q.kind.replace(/_/g, " ")}{q.scheduled_for ? ` · ${q.scheduled_for}` : ""}</p>
                <span className={`pill ${q.result === "pass" ? "p-em" : q.result === "fail" ? "p-clay" : "p-amber"}`}>
                  {q.result ?? "due"}{q.thin_record ? " · thin record" : ""}
                </span>
              </div>
            ))}
            <QaControls workOrderId={id} qaRequired={Boolean(row.qa_required)}
              scheduledCount={(qaRows ?? []).length} closed={row.stage === "closed"} />
          </div>
        </div>
      </div>
    </>
  );
}
