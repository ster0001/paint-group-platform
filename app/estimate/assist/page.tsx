import { openAssistSession } from "@/lib/agent/session";
import { getCompanyContact } from "@/lib/portal/data";
import Wordmark from "@/app/wizard/Wordmark";
import AssistView from "./AssistView";
import "./assist.css";

/**
 * /estimate/assist?c=<conversation> · or ?estimate=<id> to adopt an
 * existing draft — the assistant's GUIDED MODE (assistant brief S4).
 *
 * Split view: the chat on the left, the live confirm-loop editor on the
 * right. Both write the same tree; the person can tap tiles at any point and
 * come back to the chat. Ownership is the wizard's rule: a customer opens
 * only the conversation they created on their own customer_intake draft.
 * All server work happens in lib/agent/session.ts (the gateway is server-only).
 */

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Chat your estimate through · Paint Group",
  robots: { index: false, follow: false },
};

export default async function AssistPage({ searchParams }: { searchParams: Promise<{ c?: string; estimate?: string }> }) {
  const params = await searchParams;
  const [session, company] = await Promise.all([openAssistSession(params), getCompanyContact()]);
  if (session.kind === "holding") {
    return (
      <div className="wz">
        <header className="wz-top"><Wordmark logoUrl={company.logoUrl} /></header>
        <div className="wz-wrap" style={{ textAlign: "center", paddingTop: 80 }}><h1>{session.line}</h1></div>
      </div>
    );
  }
  const logoUrl = (session.bundle && session.bundle.kind !== "holding" ? session.bundle.logoUrl : null) || company.logoUrl || null;
  return (
    <div className="wz as-page">
      <AssistView
        conversationId={session.conversationId}
        estimateId={session.estimateId}
        disclosure={session.disclosure}
        assistantName={session.assistantName}
        logoUrl={logoUrl}
        initialTranscript={session.transcript}
        initialUi={session.ui}
        initialBundle={session.bundle}
      />
    </div>
  );
}
