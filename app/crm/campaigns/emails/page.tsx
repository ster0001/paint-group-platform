import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadSegments } from "@/lib/crm/segmentsStore";
import NewTemplate from "../NewTemplate";
import SubNav from "../../SubNav";

export const dynamic = "force-dynamic";

/**
 * The campaign studio's front door (session 3.2/3.5).
 *
 * Templates only, deliberately. Enrolment, the sweep, the guard chain and
 * sending are the next session — and until they exist, nothing here can reach
 * a customer, which is exactly the state the brief asks for ("auto-send ships
 * OFF", "draft-only").
 */
export default async function EmailsPage() {
  const supabase = await createClient();
  const segments = await loadSegments(supabase);
  // Loosely typed on purpose: the fallback select below returns fewer columns.
  let data: Record<string, unknown>[] | null;
  let error: { message: string } | null;
  ({ data, error } = await supabase
    .from("campaign_templates")
    .select("id, name, subject, segment_key, approved_at, updated_at, blocks, kind, sms_body")
    .order("updated_at", { ascending: false })
    .limit(100));
  // Before migration 20261212 the SMS columns don't exist; emails must not
  // break while waiting for them.
  if (error && /kind|sms_body/.test(error.message)) {
    ({ data, error } = await supabase
      .from("campaign_templates")
      .select("id, name, subject, segment_key, approved_at, updated_at, blocks")
      .order("updated_at", { ascending: false })
      .limit(100));
  }

  // The table arrives with migration 20261208. Until it runs, say so plainly
  // rather than showing an error nobody can act on.
  const migrationPending = !!error && /relation .* does not exist/i.test(error.message);
  const rows = (data ?? []) as Array<{
    id: string; name: string; subject: string; segment_key: string | null;
    approved_at: string | null; updated_at: string; blocks: unknown[];
    kind?: string; sms_body?: string;
  }>;

  return (
    <>
      <h2>Emails &amp; texts</h2>
      <SubNav />
      <p className="sub">
        Write it yourself or have it drafted, then read it before anyone else does.
        Written once, used by any campaign — a step sends either an email or a text.
      </p>

      {migrationPending ? (
        <p className="partial">
          The templates table hasn&rsquo;t been created yet. Run migration
          <b> 20261208_campaign_templates</b> and this fills in.
        </p>
      ) : (
        <>
          <NewTemplate segments={segments.map((s) => ({ key: s.key, name: s.name }))} />

          {rows.length === 0 ? (
            <p className="empty">No emails yet. Start one above — it takes about a minute with the writer.</p>
          ) : (
            <div className="people">
              {rows.map((t) => {
                const segment = segments.find((s) => s.key === t.segment_key);
                return (
                  <Link key={t.id} className="person" href={`/crm/campaigns/emails/${t.id}`}>
                    <span className="cname">
                      <i className={`dot ${t.approved_at ? "cold" : "warm"}`} aria-hidden="true" />
                      {t.name}
                    </span>
                    <span className="cmeta">
                      {t.kind === "sms" ? (t.sms_body?.slice(0, 60) || "Nothing written yet") : (t.subject || "No subject yet")}
                    </span>
                    <span className="cfoot">
                      <b className="cval" style={{ fontSize: 12 }}>
                        {t.kind === "sms"
                          ? "text message"
                          : `${Array.isArray(t.blocks) ? t.blocks.length : 0} block${Array.isArray(t.blocks) && t.blocks.length === 1 ? "" : "s"}`}
                      </b>
                      <span className="cwhen mono">{t.approved_at ? "approved" : "draft"}</span>
                    </span>
                    {segment && <span className="cnote">To: {segment.name}</span>}
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
