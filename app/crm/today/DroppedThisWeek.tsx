import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { journeyFromRow, journeyLine, journeyWho, pageLabel, WIZARD_SESSION_COLUMNS } from "@/lib/wizard/journey";

/**
 * Buckets brief §6 — "Dropped this week": bucket C grouped by the page they
 * stopped on, with counts, so the office can see which wizard page loses
 * people. A view inside Today, not a fifth tab. Derived from wizard_drafts
 * every read; nothing stored. Anonymous sessions (no email yet) are listed
 * too — an address is a lead in this business.
 */
export default async function DroppedThisWeek() {
  const supabase = await createClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabase.from("wizard_drafts")
    .select(WIZARD_SESSION_COLUMNS)
    .eq("bucket", "dropped").gte("dropped_at", weekAgo)
    .order("dropped_at", { ascending: false }).limit(200);
  if (error || !data || data.length === 0) return null;
  const rows = (data as unknown as Record<string, unknown>[]).map(journeyFromRow);

  const byPage = new Map<string, number>();
  for (const r of rows) {
    const k = pageLabel(r.jobType, r.furthestPage);
    byPage.set(k, (byPage.get(k) ?? 0) + 1);
  }
  const groups = [...byPage.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <section data-testid="dropped-this-week">
      <div className="slab">Dropped this week <span className="slabn mono">{rows.length}</span><i /></div>
      <div className="chips" style={{ margin: "6px 0 8px" }}>
        {groups.map(([label, n]) => (
          <span key={label} className="chip" data-testid="dropped-group">{label}<span className="chipn mono">{n}</span></span>
        ))}
      </div>
      {rows.slice(0, 12).map((r) => (
        <div key={r.id} className="qitem ok" data-testid="dropped-row">
          <span className="qico" aria-hidden="true">↯</span>
          <span className="qmain">
            <span className="qt"><span className="qsrc">Dropped · {pageLabel(r.jobType, r.furthestPage)}</span>{journeyWho(r)}</span>
            <span className="qb">{[r.address || r.suburb, journeyLine(r, now), r.entrySource].filter(Boolean).join(" · ")}</span>
            <span className="qact">
              <Link href={r.accountId ? `/crm/customers/${r.accountId}` : `/estimates?status=wizard&open=${r.id}`} className="qgo">Open →</Link>
            </span>
          </span>
        </div>
      ))}
      {rows.length > 12 && <p className="sub"><Link href="/estimates?status=wizard&bucket=dropped">All {rows.length} dropped sessions →</Link></p>}
    </section>
  );
}
