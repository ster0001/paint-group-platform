import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadSegments } from "@/lib/crm/segmentsStore";
import SubNav from "../SubNav";
import NewCampaign from "./NewCampaign";

export const dynamic = "force-dynamic";

/**
 * Campaigns (session 3.1). A campaign is a list, an email per step, and the
 * waits between them. No campaign ships built in — Tom, 29 Aug: "unsure which
 * campaign we will run first, that's the point of having this."
 */
export default async function CampaignsPage() {
  const supabase = await createClient();
  const segments = await loadSegments(supabase);
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, segment_key, status, steps, auto_send, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  const migrationPending = !!error && /does not exist/i.test(error.message);
  const rows = (data ?? []) as Array<{
    id: string; name: string; segment_key: string; status: string;
    steps: unknown[]; auto_send: boolean; updated_at: string;
  }>;

  return (
    <>
      <h2>Campaigns</h2>
      <SubNav />
      <p className="sub">
        A list, an email, and how long to wait. Nothing sends on its own — every message waits for
        someone to read it, and the dry run tells you exactly who would get it before you turn it on.
      </p>

      {migrationPending ? (
        <p className="partial">
          The campaign tables haven&rsquo;t been created yet. Run migration <b>20261209_campaign_engine</b>.
        </p>
      ) : (
        <>
          <NewCampaign segments={segments.map((s) => ({ key: s.key, name: s.name }))} />

          {rows.length === 0 ? (
            <p className="empty">
              No campaigns yet. Start one above — you can build it, dry-run it, and leave it as a draft
              for as long as you like.
            </p>
          ) : (
            <div className="people">
              {rows.map((c) => {
                const segment = segments.find((s) => s.key === c.segment_key);
                const steps = Array.isArray(c.steps) ? c.steps.length : 0;
                return (
                  <Link key={c.id} className="person" href={`/crm/campaigns/c/${c.id}`}>
                    <span className="cname">
                      <i className={`dot ${c.status === "live" ? "warm" : "cold"}`} aria-hidden="true" />
                      {c.name}
                    </span>
                    <span className="cmeta">To: {segment?.name ?? c.segment_key}</span>
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
