import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { loadDemoGrid } from "@/lib/demo/checklistLoad";
import { DEMO_STEPS } from "@/lib/demo/checklist";
import { reportError } from "@/lib/monitoring/report";
import { loadInductionStatuses } from "@/lib/induction/progress";

export const dynamic = "force-dynamic";

/**
 * PC Command → Induction: the facilitator's live grid (induction brief §4.2
 * "Progress") — one row per practice job in the room, one column per "On
 * your phone" step, ticked from the job's own rows. Reload to refresh; the
 * robots answer within seconds, so a reload after each slide is enough.
 */
export default async function PcDemoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me, error: meErr } = user ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : { data: null, error: null };
  if (meErr) reportError(meErr, { where: "pc.demo.role" });
  if ((me as { role?: string } | null)?.role !== "staff") return <section className="pc-section"><p className="empty">Staff only.</p></section>;
  const service = createServiceClient();
  const { rows, error } = service ? await loadDemoGrid(service) : { rows: [], error: "messaging service unavailable" };
  // Step 5: the induction ticks beside the demo steps, through the one RPC.
  const induction = service ? await loadInductionStatuses(service) : { rows: [], error: "messaging service unavailable" };
  const ticksOf = new Map(induction.rows.map((r) => [r.contractorId, r]));

  return (
    <section className="pc-section" data-testid="demo-grid">
      <header className="pc-head">
        <h2>Induction — practice jobs</h2>
        <p className="small">Every painter with 12 Demo Street on their account, and the steps they have done on their phone. Reload to refresh.</p>
      </header>
      {error && <p className="empty" data-testid="demo-grid-failure" style={{ color: "var(--amber)" }}>{error} — what is shown may be incomplete. It has been reported.</p>}
      {rows.length === 0 ? (
        <p className="empty" data-testid="demo-grid-empty">No practice jobs yet. Set one up from a painter&apos;s record under Contractors, or the painter starts it from their Jobs tab.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="pc-table" data-testid="demo-grid-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Painter</th>
                <th>Done</th>
                <th title="Induction modules ticked">Ticks</th>
                {DEMO_STEPS.map((s) => <th key={s.key} title={s.label} style={{ fontSize: 10, whiteSpace: "nowrap" }}>M{s.module}<br />{s.key.replace("_", " ")}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.workOrderId} data-testid={`demo-row-${r.contractorId}`} data-done={r.done}>
                  <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                    <Link href={`/pc/wo/${r.workOrderId}`}>{r.painter}</Link>
                    <span className="small" style={{ display: "block", color: "var(--muted)" }}>{r.woRef}</span>
                  </td>
                  <td data-testid={`demo-done-${r.contractorId}`}><b>{r.done}</b> / {r.total}</td>
                  <td data-testid={`demo-ticks-${r.contractorId}`} style={{ color: ticksOf.get(r.contractorId)?.complete ? "var(--emerald)" : undefined }}>
                    {ticksOf.has(r.contractorId) ? `${ticksOf.get(r.contractorId)!.ticked} / ${ticksOf.get(r.contractorId)!.total}${ticksOf.get(r.contractorId)!.checkPassed ? " ✓" : ""}` : "·"}
                  </td>
                  {r.rows.map((s) => (
                    <td key={s.key} data-testid={`demo-step-${r.contractorId}-${s.key}`} data-done={s.done} title={s.detail}
                      style={{ textAlign: "center", color: s.done ? "var(--emerald)" : "var(--muted)" }}>
                      {s.done ? "✓" : "·"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
