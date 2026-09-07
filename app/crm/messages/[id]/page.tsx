import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AttachMessage from "./AttachMessage";

export const dynamic = "force-dynamic";

/**
 * P3 — one inbound message that could not be matched to a customer. Not a
 * fifth tab: Today's "unmatched" item lands here, a person picks the
 * customer, and the message joins that record. A matched message redirects
 * to its record.
 */
export default async function UnmatchedMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("messages")
    .select("id, account_id, channel, direction, subject, body, from_address, to_address, occurred_at")
    .eq("id", id).maybeSingle();
  if (!data) {
    return (<><Link className="back" href="/crm/today">← Today</Link><p className="empty">That message isn&rsquo;t here.</p></>);
  }
  const m = data as { id: string; account_id: string | null; channel: string; subject: string | null; body: string; from_address: string | null; to_address: string | null; occurred_at: string };
  if (m.account_id) redirect(`/crm/customers/${m.account_id}#messages`);

  const when = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(m.occurred_at));
  return (
    <>
      <Link className="back" href="/crm/today">← Today</Link>
      <h2>A {m.channel === "sms" ? "text" : m.channel} we couldn&rsquo;t match</h2>
      <p className="sub">From {m.from_address ?? "an unknown sender"} · {when}. Pick the customer it belongs to and it joins their record.</p>
      <div className="msg in" style={{ marginBottom: 16 }}>
        <span>
          {m.subject && <span className="msghead"><b>{m.subject}</b></span>}
          <span className="msgbody">{m.body}</span>
        </span>
      </div>
      <p className="plabel">Whose is it?</p>
      <AttachMessage messageId={m.id} hint={m.from_address ?? ""} />
    </>
  );
}
