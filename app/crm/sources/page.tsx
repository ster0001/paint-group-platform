import { createClient } from "@/lib/supabase/server";
import { sourceReport, type SourceKey } from "@/lib/crm/attribution";
import { isWon } from "@/lib/crm/stage";
import SubNav from "../SubNav";

export const dynamic = "force-dynamic";

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");

/**
 * Where the work comes from (session 2.4) — the mockup's Lead sources tab.
 *
 * First touch, per the mockup's own subtitle. Accounts with nothing recorded
 * are shown as "Not recorded" rather than left out: attribution started on
 * 29 Aug 2026, so everything before it is genuinely unknown, and a report that
 * hides that reads as though the tagged rows are the whole business.
 */
export default async function SourcesPage() {
  const supabase = await createClient();

  const [{ data: accounts }, { data: firstTouches }, { data: won }] = await Promise.all([
    supabase.from("accounts").select("id").limit(2000),
    supabase.from("crm_events")
      .select("account_id, payload, occurred_at")
      .eq("type", "first_touch_recorded")
      .not("account_id", "is", null)
      .limit(2000),
    // Won = the STATUS, not the timestamp: see isWon() for why.
    supabase.from("estimates")
      .select("account_id, status, accepted_total_cents, total_cents, accepted_at")
      .not("account_id", "is", null)
      .or("status.eq.accepted,accepted_at.not.is.null")
      .limit(2000),
  ]);

  const sourceOf = new Map<string, SourceKey>();
  for (const e of firstTouches ?? []) {
    const src = (e.payload as { source?: string } | null)?.source;
    if (src) sourceOf.set(e.account_id as string, src as SourceKey);
  }
  const wonByAccount = new Map<string, number>();
  for (const e of won ?? []) {
    if (!isWon({ status: e.status as string, accepted_at: e.accepted_at as string | null })) continue;
    const cents = (e.accepted_total_cents as number | null) ?? (e.total_cents as number | null) ?? 0;
    wonByAccount.set(e.account_id as string, (wonByAccount.get(e.account_id as string) ?? 0) + cents);
  }

  const { rows, totals } = sourceReport(
    (accounts ?? []).map((a) => ({
      source: sourceOf.get(a.id as string) ?? null,
      wonCents: wonByAccount.get(a.id as string) ?? null,
    })),
  );
  const untagged = rows.find((r) => r.source === "unknown")?.leads ?? 0;

  return (
    <>
      <SubNav />
      <h2>Where the work comes from</h2>
      <p className="sub">
        First touch. Every enquiry is tagged on arrival — the advert, the search, the referral link —
        and kept, so a later ad click can&rsquo;t take credit for word of mouth.
      </p>

      {untagged > 0 && (
        <p className="partial">
          {untagged} of {totals.leads} customers pre-date tagging, which started today.
          They sit under &ldquo;not recorded&rdquo; rather than being left out — the report is honest
          about what it doesn&rsquo;t know.
        </p>
      )}

      {totals.leads === 0 ? (
        <p className="empty">No customers yet.</p>
      ) : (
        <div className="table">
          <div className="trow thead">
            <span>Source</span><span className="num">Leads</span><span className="num">Won</span><span className="num">Revenue</span>
          </div>
          {rows.map((r) => (
            <div className="trow" key={r.source}>
              <span>{r.label}</span>
              <span className="num mono">{r.leads}</span>
              <span className="num mono">{r.won}</span>
              <span className="num mono">{r.revenueCents ? money(r.revenueCents) : "—"}</span>
            </div>
          ))}
          <div className="trow tfoot">
            <span>All sources</span>
            <span className="num mono">{totals.leads}</span>
            <span className="num mono">{totals.won}</span>
            <span className="num mono">{totals.revenueCents ? money(totals.revenueCents) : "—"}</span>
          </div>
        </div>
      )}
    </>
  );
}
