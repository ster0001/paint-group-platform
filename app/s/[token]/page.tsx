import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Walkthrough from "./Walkthrough";
import "@/app/e/customer.css";
import "@/app/v/[token]/variation.css";
import "./walkthrough.css";

export const dynamic = "force-dynamic";

type Row = {
  wo_ref: string; job_title: string; areas: Record<string, { approved_at?: string; flagged_at?: string; note?: string }>;
  signed_at: string | null; signed_name: string | null; deadline_at: string | null; headings: string[];
};

export default async function WalkthroughPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();

  const { data } = await supabase.rpc("wo_walkthrough_by_token", { p_token: token });
  const row = ((data as Row[] | null) ?? [])[0];
  if (!row) notFound();

  // A viewed-but-unsigned pack is the record that matters later; best-effort.
  await supabase.rpc("wo_record_signoff_view", { p_token: token }).then(() => {}, () => {});

  const initial: Record<string, { approved?: boolean; flagged?: boolean; note?: string }> = {};
  for (const [area, state] of Object.entries(row.areas ?? {})) {
    initial[area] = {
      approved: Boolean(state?.approved_at),
      flagged: Boolean(state?.flagged_at),
      note: state?.note,
    };
  }

  return (
    <main className="cv">
      <div className="cv-wrap">
        <span className="status">Ready for your look</span>
        <h1>Your job is finished</h1>
        <p className="cv-sub">{row.job_title || row.wo_ref}</p>
        <p className="cv-fine" style={{ marginTop: 10 }}>
          Have a walk round and tell us how each part looks. If anything isn&rsquo;t
          right, say so — that&rsquo;s what this is for, and it goes straight back to
          the painter.
        </p>

        <Walkthrough
          token={token}
          headings={row.headings ?? []}
          initial={initial}
          signedName={row.signed_at ? row.signed_name : null}
        />
      </div>
    </main>
  );
}
