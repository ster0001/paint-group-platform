import Link from "next/link";
import { openSupportSession } from "@/lib/agent/session";
import SupportView from "./SupportView";

/**
 * /account/assist/[estimateId] — SUPPORT MODE (assistant brief §3.3, S6).
 * Answers come from this estimate's own data first, then the Brain (approved
 * entries only), then a person. Change requests on a sent estimate become a
 * flag for staff; visits go through the visit-policy function; "Talk to a
 * person" is always there.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask the assistant · Paint Group" };

export default async function SupportPage({ params }: { params: Promise<{ estimateId: string }> }) {
  const { estimateId } = await params;
  const session = await openSupportSession(estimateId);
  if (session.kind === "holding") return <div><h1>{session.line}</h1></div>;
  return (
    <div>
      <Link href={`/account/messages/${session.estimateId}`} className="note" style={{ display: "inline-block", marginBottom: 14 }}>← Messages</Link>
      <h1>{session.title}</h1>
      <p className="note" style={{ marginBottom: 12 }}>{session.disclosure}</p>
      <SupportView conversationId={session.conversationId} estimateId={session.estimateId} shareToken={session.shareToken} initialTranscript={session.transcript} />
    </div>
  );
}
