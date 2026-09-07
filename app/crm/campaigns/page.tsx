import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadSegments } from "@/lib/crm/segmentsStore";
import { TRIGGER_EVENTS } from "@/lib/campaigns/sweep";
import SubNav from "../SubNav";
import NewCampaign from "./NewCampaign";

export const dynamic = "force-dynamic";

/**
 * Campaigns (P5). A campaign is a kind (quote follow-up or marketing), a
 * start (a list, or an event), exit rules, and steps with waits counted from
 * the start. No campaign ships built in — Tom, 29 Aug: "unsure which campaign
 * we will run first, that's the point of having this."
 */
export default async function CampaignsPage() {
  const supabase = await createClient();
  const segments = await loadSegments(supabase);
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, class, entry, segment_key, trigger_event, status, steps, auto_send, updated_at, last_swept_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  const migrationPending = !!error && /does not exist/i.test(error.message);
  const rows = (data ?? []) as Array<{
    id: string; name: string; class: string; entry: string; segment_key: string | null; trigger_event: string | null;
    status: string; steps: unknown[]; auto_send: boolean; updated_at: string; last_swept_at: string | null;
  }>;
  const { count: waiting } = await supabase.from("campaign_messages").select("id", { count: "exact", head: true }).in("state", ["queued", "held"]);

  return (
    <>
      <h2>Campaigns</h2>
      <SubNav />
      <p className="sub">
        A follow-up that starts when an estimate goes out and stops the moment they answer; a marketing
        sequence to a list. Every message walks the guard chain before it leaves, and the dry run tells
        you exactly who would get it before you turn it on.
        {waiting ? <> <Link href="/crm/campaigns/queue" style={{ textDecoration: "underline" }}>{waiting} waiting for approval</Link>.</> : null}
      </p>

      {migrationPending ? (
        <p className="partial">
          The campaign tables haven&rsquo;t been created yet. Run migration <b>20261209_campaign_engine</b>.
        </p>
      ) : (
        <>
          <NewCampaign segments={segments.filter((s) => !s.invalid).map((s) => ({ key: s.key, name: s.name }))} />

          {rows.length === 0 ? (
            <p className="empty">
              No campaigns yet. Start one above — you can build it, dry-run it, and leave it as a draft
              for as long as you like.
            </p>
          ) : (
            <div className="people">
              {rows.map((c) => {
                const segment = segments.find((s) => s.key === c.segment_key);
                const trigger = TRIGGER_EVENTS.find((t) => t.key === c.trigger_event);
                const steps = Array.isArray(c.steps) ? c.steps.length : 0;
                return (
                  <Link key={c.id} className="person" href={`/crm/campaigns/c/${c.id}`}>
                    <span className="cname">
                      <i className={`dot ${c.status === "live" ? "warm" : "cold"}`} aria-hidden="true" />
                      {c.name}
                    </span>
                    <span className="cmeta">
                      {c.class === "followup" ? "Quote follow-up" : "Marketing"} ·{" "}
                      {c.entry === "event" ? `when ${trigger?.label.toLowerCase() ?? c.trigger_event}` : `to ${segment?.name ?? c.segment_key ?? "a list"}`}
                    </span>
                    <span className="cfoot">
                      <b className="cval" style={{ fontSize: 12 }}>{steps} step{steps === 1 ? "" : "s"}</b>
                      <span className="cwhen mono">{c.status}</span>
                    </span>
                    {c.auto_send && <span className="cnote">Auto-send is ON</span>}
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
