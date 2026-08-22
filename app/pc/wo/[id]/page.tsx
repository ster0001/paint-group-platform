import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { STAGE_LANES, WO_STAGES, type WoStage } from "@/lib/workorder/stages";
import { progressByHeading, progressOf, type SurfaceRow } from "@/lib/workorder/surfaces";
import { VARIATION_STEPS, stepIndex, type VariationStatus } from "@/lib/workorder/variations";
import PriceVariation from "./PriceVariation";
import Checklist, { type ChecklistItem } from "./Checklist";

export const dynamic = "force-dynamic";

const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });

export default async function PcWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: wo } = await supabase
    .from("work_orders")
    .select("id, wo_ref, stage, blocked_reason, contractor_payment_cents, start_date, end_date, estimate_id, wo_snapshot, estimates(total_cents, deposit_paid_at:accepted_at)")
    .eq("id", id).maybeSingle();
  if (!wo) notFound();

  const row = wo as unknown as {
    id: string; wo_ref: string; stage: WoStage; blocked_reason: string | null;
    contractor_payment_cents: number | null; start_date: string | null;
    wo_snapshot: { jobTitle?: string; jobAddress?: string } | null;
    estimates: { total_cents: number | null; deposit_paid_at: string | null } | null;
  };

  const estimateId = (wo as { estimate_id?: string }).estimate_id ?? "";

  const [{ data: surfaceRows }, { data: variationRows }, { data: updateRows }, { data: qaRows }, { data: checklistRows }, { data: rateRow }] =
    await Promise.all([
      supabase.from("wo_surfaces")
        .select("id, heading, heading_meta, label, state, rectification")
        .eq("work_order_id", id).order("sort"),
      supabase.from("wo_variations")
        .select("id, category, comment, status, est_hours, price_cents, contractor_delta_cents, released_at")
        .eq("work_order_id", id).order("created_at", { ascending: false }),
      supabase.from("wo_updates").select("id, draft_text, final_text, status, for_date")
        .eq("work_order_id", id).order("for_date", { ascending: false }).limit(1),
      supabase.from("wo_qa_checks").select("id, kind, result, thin_record").eq("work_order_id", id),
      supabase.from("wo_checklist_items")
        .select("id, phase, label, detail, required, done_at, auto_key")
        .eq("work_order_id", id).order("phase").order("sort"),
      // The live contractor rate, so the price preview cannot drift from what
      // the server will actually work out when Tom edits it in Settings.
      supabase.from("settings").select("value").eq("key", "Contractor rate").maybeSingle(),
    ]);

  // Derived items answer from the data they read, so the screen and the gate
  // can never disagree about whether a stage is ready.
  const coloursConfirmed = Boolean(
    (await supabase.rpc("wo_colours_confirmed", { p_work_order_id: id })).data,
  );
  const qaScheduled = ((qaRows ?? []) as unknown[]).length > 0;

  const checklist = ((checklistRows ?? []) as {
    id: string; phase: string; label: string; detail: string;
    required: boolean; done_at: string | null; auto_key: string | null;
  }[]).map((r): ChecklistItem & { phase: string } => ({
    phase: r.phase, id: r.id, label: r.label, detail: r.detail ?? "", required: r.required,
    auto: r.auto_key,
    done: r.auto_key === "colours" ? coloursConfirmed
        : r.auto_key === "qa" ? qaScheduled
        : r.done_at !== null,
  }));

  const forPhase = (phase: string) => checklist.filter((c) => c.phase === phase);
  const outstanding = (phase: string) =>
    forPhase(phase).filter((c) => c.required && !c.done).length;

  const contractorRateCents = Math.round(
    Number((rateRow as { value?: { value?: number } } | null)?.value?.value ?? 60) * 100,
  );

  const surfaces = ((surfaceRows ?? []) as {
    id: string; heading: string; heading_meta: string; label: string;
    state: SurfaceRow["state"]; rectification: boolean;
  }[]);
  const progress = progressOf(surfaces);
  const byHeading = progressByHeading(surfaces);
  const headings = [...new Set(surfaces.map((s) => s.heading))];

  const variations = ((variationRows ?? []) as {
    id: string; category: string; comment: string; status: VariationStatus;
    est_hours: string | null; price_cents: number | null;
    contractor_delta_cents: number | null; released_at: string | null;
  }[]);

  const contract = row.estimates?.total_cents ?? 0;
  const contractorPay = row.contractor_payment_cents ?? 0;
  const approvedVariations = variations
    .filter((v) => v.status === "contractor_accepted")
    .reduce((sum, v) => sum + (v.price_cents ?? 0), 0);
  const pendingVariations = variations.some((v) =>
    v.status === "raised" || v.status === "priced" || v.status === "customer_approved");
  const gp = contract > 0 ? Math.round(((contract - contractorPay) / contract) * 1000) / 10 : 0;

  const stageIndex = WO_STAGES.indexOf(row.stage);
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
            <a className="btn" href={`/quote?id=${estimateId}&view=workorder`} data-testid="edit-wo">
              Edit job sheet
            </a>
          </span>
        </div>

        <div className="rail7" data-testid="stage-rail">
          {WO_STAGES.map((stage, i) => (
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
              {pendingVariations ? "+ pending" : approvedVariations > 0 ? `+ ${money(approvedVariations)}` : "—"}
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
                  <div className="tick" key={s.id}>
                    <span className="sw" aria-hidden="true">
                      <i className={s.state !== "todo" ? "a" : ""} />
                      <i className={s.state === "done" ? "a" : s.state === "prepped" ? "b" : ""} />
                      <i className={s.state === "done" ? "a" : ""} />
                    </span>
                    <p>{s.label}</p>
                    <span className={`pill ${s.state === "done" ? "p-em" : s.state === "prepped" ? "p-cy" : s.rectification ? "p-amber" : ""}`}>
                      {s.rectification && s.state !== "done" ? "Rectify" : s.state === "done" ? "Done" : s.state === "prepped" ? "Prepped" : "To do"}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}

          {surfaces.length === 0 && <p className="note">No tick list yet — it seeds when the job sheet is issued.</p>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {row.stage === "offered" && forPhase("pre_offer").length > 0 && (
            <Checklist
              title="Ready to offer"
              caption="Not ready to start — colours can still be TBC when the contractor accepts."
              items={forPhase("pre_offer")}
              outstanding={outstanding("pre_offer")}
            />
          )}

          {row.stage === "pre_start" && forPhase("pre_start").length > 0 && (
            <Checklist
              title="Pre-start"
              caption="Everything the site needs, arranged before day one. The job cannot start until these are true."
              items={forPhase("pre_start")}
              outstanding={outstanding("pre_start")}
            />
          )}

          {row.stage === "completion_prep" && forPhase("completion_prep").length > 0 && (
            <Checklist
              title="Completion prep"
              caption="The last pass before the customer walks through."
              items={forPhase("completion_prep")}
              outstanding={outstanding("completion_prep")}
            />
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
                {v.est_hours ? ` · est. ${Number(v.est_hours)} hrs` : ""}</b>
              </div>
              <PriceVariation
                id={v.id}
                status={v.status}
                released={v.released_at !== null}
                estHours={v.est_hours === null ? null : Number(v.est_hours)}
                priceCents={v.price_cents}
                deltaCents={v.contractor_delta_cents}
                rateCents={contractorRateCents}
              />
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

          <div className="card">
            <h3>Job facts</h3>
            <div className="tick"><p>Start date</p><span className="pill">{row.start_date ?? "TBC"}</span></div>
            <div className="tick"><p>QA checks</p>
              <span className={`pill ${(qaRows ?? []).length === 0 ? "" : "p-cy"}`}>
                {(qaRows ?? []).length === 0 ? "Not required — established" : `${(qaRows ?? []).length} scheduled`}
              </span>
            </div>
            {((qaRows ?? []) as { id: string; kind: string; result: string | null; thin_record: boolean }[]).map((q) => (
              <div className="tick" key={q.id}>
                <p>{q.kind.replace(/_/g, " ")}</p>
                <span className={`pill ${q.result === "pass" ? "p-em" : q.result === "fail" ? "p-clay" : "p-amber"}`}>
                  {q.result ?? "due"}{q.thin_record ? " · thin record" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
