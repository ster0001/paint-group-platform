import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { evaluateSegment } from "@/lib/crm/segments";
import { loadSegments } from "@/lib/crm/segmentsStore";
import { loadSubjects } from "@/lib/crm/loadSubjects";
import SubNav from "../SubNav";

export const dynamic = "force-dynamic";

/**
 * The lists — all of them yours now (Tom, 30 Aug). The three that shipped with
 * the product are ordinary editable rows like any other; a new one is built in
 * the app, not in a deploy.
 */
export default async function SegmentsPage() {
  const supabase = await createClient();
  const [segments, subjects] = await Promise.all([
    loadSegments(supabase),
    loadSubjects(supabase),
  ]);

  const counts = new Map(segments.map((s) => [
    s.key,
    s.criteria.length === 0 ? null : evaluateSegment(subjects, s).length,
  ]));

  return (
    <>
      <SubNav />
      <h2>Lists</h2>
      <p className="sub">
        Build a list once and every campaign, count and report reads the same one. The rules can ask
        who they are, what they&rsquo;ve had done, and where they are in their journey — including an
        unfinished estimate and how far through it they got.
      </p>

      <Link href="/crm/segments/new" className="go" style={{ display: "inline-block", marginBottom: 16 }}>
        + New list
      </Link>

      {segments.length === 0 ? (
        <p className="empty">No lists yet — run migration 20261211 to seed the starters, or build your first above.</p>
      ) : (
        <div className="people">
          {segments.map((s) => (
            <Link key={s.key} className="person" href={`/crm/segments/${s.key}`}>
              <span className="cname">{s.name}</span>
              <span className="cmeta">{s.description || `${s.criteria.length} rule${s.criteria.length === 1 ? "" : "s"}`}</span>
              <span className="cfoot">
                <b className="cval" style={{ fontSize: 12 }}>
                  {counts.get(s.key) == null ? "needs a re-save" : `${counts.get(s.key)} match today`}
                </b>
                <span className="cwhen mono">{s.standing ? "starter" : "yours"}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
