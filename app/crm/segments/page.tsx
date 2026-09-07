import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadSegments } from "@/lib/crm/segmentsStore";
import { countAudience } from "@/lib/crm/audience";
import { ruleCount } from "@/lib/crm/segments";
import SubNav from "../SubNav";

export const dynamic = "force-dynamic";

/**
 * The lists — all of them yours now (Tom, 30 Aug). The three that shipped with
 * the product are ordinary editable rows like any other; a new one is built in
 * the app, not in a deploy. Counts come from the database in milliseconds
 * whatever the size of the customer base (P5).
 */
export default async function SegmentsPage() {
  const supabase = await createClient();
  const segments = await loadSegments(supabase);
  const counts = new Map<string, number | null>();
  await Promise.all(segments.map(async (s) => {
    if (s.invalid || ruleCount(s.audience) === 0) { counts.set(s.key, null); return; }
    try { counts.set(s.key, await countAudience(supabase, s.audience)); } catch { counts.set(s.key, null); }
  }));

  return (
    <>
      <SubNav />
      <h2>Lists</h2>
      <p className="sub">
        Build a list once and every campaign, count and report reads the same one. Rules can ask who they
        are, what they&rsquo;ve had done, how they treated their estimate, and where they are in their
        journey — in groups, with and / or / not.
      </p>

      <Link href="/crm/segments/new" className="go" style={{ display: "inline-block", marginBottom: 16 }}>
        + New list
      </Link>

      {segments.length === 0 ? (
        <p className="empty">No lists yet — run migration 20261211 to seed the starters, or build your first above.</p>
      ) : (
        <div className="people">
          {segments.map((s) => {
            const n = ruleCount(s.audience);
            const count = counts.get(s.key);
            return (
              <Link key={s.key} className="person" href={`/crm/segments/${s.key}`}>
                <span className="cname">{s.name}</span>
                <span className="cmeta">{s.description || `${n} rule${n === 1 ? "" : "s"}`}</span>
                <span className="cfoot">
                  <b className="cval" style={{ fontSize: 12 }}>
                    {count == null ? "needs a re-save" : `${count.toLocaleString("en-AU")} match today`}
                  </b>
                  <span className="cwhen mono">{s.legacy ? "check & re-save" : s.standing ? "starter" : "yours"}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
