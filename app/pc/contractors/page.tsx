import { createClient } from "@/lib/supabase/server";
import { loadContractorsView } from "@/lib/painterStatus/contractorsLoad";
import ContractorRows from "./ContractorRows";
import Recompute from "./Recompute";

export const dynamic = "force-dynamic";

/**
 * PC Command → Contractors (brief §7, Step 8): counts by colour; open call
 * backs, rewards due, not signed; one row per painter with the light, checks,
 * app, call backs, streak, trend and tags; tap a row for the last 10 jobs,
 * the bonus history (staff only), Spot check and Log call back. Every number
 * comes from `loadContractorsView` — the same model the home dashboard's
 * Contractor tiles read — so the strip and the list cannot disagree.
 */
const COLOURS = [["green", "Green"], ["yellow", "Yellow"], ["orange", "Orange"], ["red", "Red"], ["new", "New"]] as const;

export default async function PcContractorsPage() {
  const supabase = await createClient();
  const { view, error } = await loadContractorsView(supabase, new Date());
  const c = view.counts;
  return (
    <section data-testid="painter-status">
      <div className="sect-h" style={{ marginTop: 0 }}>
        <h2 style={{ margin: 0 }}>Contractors</h2>
        <span className="muted" style={{ fontSize: 12 }}>Scores, lights and bonus amounts are never shown to customers. Painters see their own light only.</span>
        <Recompute />
      </div>
      {error && <p className="empty" data-testid="contractors-failure" style={{ color: "var(--amber)" }}>{error} — what is shown may be incomplete. It has been reported.</p>}

      <div className="ctr-lights" data-testid="contractors-lights">
        {COLOURS.map(([k, label]) => (
          <div key={k} className="ctr-lightcount" data-testid={`count-${k}`}>
            <span className={`stl stl-${k}`} aria-hidden />
            <b>{c[k]}</b>
            <span className="k">{label}</span>
          </div>
        ))}
      </div>
      <div className="ctr-stats">
        <div className="ctr-stat"><span className="k">Open call backs</span><b data-testid="count-callbacks">{c.openCallbacks}</b></div>
        <div className="ctr-stat"><span className="k">Rewards due</span><b data-testid="count-bonus">{c.bonusDue}</b></div>
        <div className="ctr-stat"><span className="k">Not signed</span><b data-testid="count-unsigned">{c.notSigned}</b></div>
      </div>

      <ContractorRows rows={view.rows} />
    </section>
  );
}
