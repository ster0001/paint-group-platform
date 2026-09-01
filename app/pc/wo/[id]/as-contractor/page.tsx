import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { toJob } from "@/lib/contractor/jobs";
import WorkOrderDoc from "@/app/w/WorkOrderDoc";
import TickList from "@/app/components/wo/TickList";
import Variations, { type VariationView } from "@/app/portal/jobs/[id]/Variations";
import PrepChecklist, { type PrepItem } from "@/app/portal/jobs/[id]/PrepChecklist";
import type { SurfaceRow } from "@/lib/workorder/surfaces";
import "@/app/portal/portal.css";

export const dynamic = "force-dynamic";

/**
 * The contractor's own view of a job, for the office.
 *
 * Not a staff rebuild of it — the same components the painter uses, so what the
 * coordinator sees on a quality visit is what the painter sees on site. Every
 * action still goes through the same RPCs and is recorded as `staff`, so the
 * event log always says who actually did it.
 *
 * The address and contact are NOT redacted here: this is the office's own view
 * of their own job. The privacy gate exists to keep a customer's address from a
 * painter who has only been asked about the job, which is a different question.
 */
export default async function AsContractorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: woRow } = await supabase
    .from("work_orders")
    .select("id, wo_ref, status, stage, start_date, end_date, issued_at, viewed_at, contractor_payment_cents, wo_snapshot, estimate_id, contractors(company_name)")
    .eq("id", id).maybeSingle();
  if (!woRow) notFound();

  const row = woRow as unknown as {
    id: string; wo_ref: string; status: string; stage: string;
    start_date: string | null; issued_at: string | null; viewed_at: string | null;
    contractor_payment_cents: number | null; wo_snapshot: unknown;
    contractors: { company_name: string } | null;
  };

  // committed = true: the office is not the party the privacy gate protects.
  const job = toJob({
    id: row.id, wo_ref: row.wo_ref, status: row.status, start_date: row.start_date,
    issued_at: row.issued_at, viewed_at: row.viewed_at,
    contractor_payment_cents: row.contractor_payment_cents, wo_snapshot: row.wo_snapshot,
  } as Parameters<typeof toJob>[0], true);
  // No v1 snapshot (job not issued yet, or a legacy row) is NOT a 404 — that
  // was exactly how "Painter's view doesn't work" presented: the console page
  // tolerates a missing snapshot, so the button rendered and the click died.
  // Render what exists and say plainly why the job sheet is absent.

  const [{ data: surfaceRows }, { data: photoRows }, { data: variationRows }, { data: prepRows }] =
    await Promise.all([
      supabase.from("wo_surfaces")
        .select("id, heading, heading_meta, label, state, rectification")
        .eq("work_order_id", id).order("sort"),
      supabase.from("wo_photos").select("area, kind").eq("work_order_id", id).in("kind", ["before", "completion"]),
      supabase.from("wo_variations")
        .select("id, category, comment, status, contractor_delta_cents, est_hours, released_at")
        .eq("work_order_id", id).order("created_at", { ascending: false }),
      supabase.from("wo_checklist_items")
        .select("id, label, detail, required, done_at, kind, item_key, answer, answer_note")
        .eq("work_order_id", id).eq("phase", "completion_prep").order("sort"),
    ]);

  const surfaces = ((surfaceRows ?? []) as {
    id: string; heading: string; heading_meta: string; label: string;
    state: SurfaceRow["state"]; rectification: boolean;
  }[]);

  const headingMeta: Record<string, string> = {};
  for (const s of surfaces) if (s.heading_meta) headingMeta[s.heading] = s.heading_meta;

  const variations: VariationView[] = ((variationRows as {
    id: string; category: string; comment: string; status: VariationView["status"];
    contractor_delta_cents: number | null; est_hours: string | null; released_at: string | null;
  }[] | null) ?? []).map((v) => ({
    id: v.id, category: v.category, comment: v.comment, status: v.status,
    contractorDeltaCents: v.contractor_delta_cents,
    estHours: v.est_hours === null ? null : Number(v.est_hours),
    released: v.released_at !== null,
  }));

  const prepItems: PrepItem[] = ((prepRows as {
    id: string; label: string; detail: string | null; required: boolean; done_at: string | null;
    kind: string | null; item_key: string | null; answer: string | null; answer_note: string | null;
  }[] | null) ?? []).map((r) => ({
    id: r.id, label: r.label, detail: r.detail ?? "", required: r.required, done: r.done_at !== null,
    kind: r.kind === "yes_no" || r.kind === "note" ? r.kind : "tick",
    itemKey: r.item_key, answer: r.answer === "yes" || r.answer === "no" ? r.answer : null,
    answerNote: r.answer_note ?? "",
  }));

  return (
    <div className="pt">
      <div style={{ padding: "0 0 12px" }}>
        <Link href={`/pc/wo/${id}`} className="backlink">← Back to the console view</Link>
        <div className="card amberish" style={{ marginTop: 8 }}>
          <span className="chip amb">Acting for {row.contractors?.company_name || "the painter"}</span>
          <div style={{ marginTop: 8, fontSize: "12.5px", color: "var(--muted)" }}>
            This is the painter&rsquo;s own screen. Anything you tick here is saved
            against the job and recorded as you, not as them.
          </div>
        </div>
      </div>

      {row.stage === "in_progress" && surfaces.length > 0 && (
        <TickList
          workOrderId={id}
          surfaces={surfaces.map((s) => ({
            id: s.id, heading: s.heading, label: s.label, state: s.state, rectification: s.rectification,
          }))}
          headingsWithBeforePhoto={[...new Set(
            ((photoRows as { area: string; kind: string }[] | null) ?? [])
              .filter((p) => p.kind === "before").map((p) => p.area).filter(Boolean),
          )]}
          headingsWithAfterPhoto={[...new Set(
            ((photoRows as { area: string; kind: string }[] | null) ?? [])
              .filter((p) => p.kind === "completion").map((p) => p.area).filter(Boolean),
          )]}
          headingMeta={headingMeta}
        />
      )}

      {row.stage === "completion_prep" && prepItems.length > 0 && <PrepChecklist items={prepItems} />}

      <Variations workOrderId={id} variations={variations} />

      {job.doc ? (
        <WorkOrderDoc doc={job.doc} />
      ) : (
        <div className="card" style={{ marginTop: 12 }} data-testid="no-snapshot">
          <b>No job sheet yet</b>
          <p className="note" style={{ marginTop: 6 }}>
            This job hasn&rsquo;t been issued to a painter, so there&rsquo;s no frozen job
            sheet to show. Issue it from the builder&rsquo;s Work order tab and this
            view fills in.
          </p>
          <Link href={`/quote?id=${(woRow as { estimate_id?: string }).estimate_id ?? ""}&view=workorder&from=${encodeURIComponent(`/pc/wo/${id}/as-contractor`)}`} className="backlink">
            Open the job sheet in the builder →
          </Link>
        </div>
      )}
    </div>
  );
}
