import { openCoworkSession } from "@/lib/agent/session";
import CoworkView from "./CoworkView";
import "@/app/wizard/wizard.css";
import "@/app/estimate/assist/assist.css";

/**
 * /estimates/[id]/assist — CO-WORK MODE for staff (assistant brief §3.2, S5).
 * "new" opens a blank draft. Paste anything; the assistant proposes a tree
 * diff with every fill-in listed and the gap batch grouped by $ impact; the
 * staff member answers gaps and applies. Nothing lands on the estimate until
 * Apply — the assistant is editing someone else's estimate.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Assistant · co-work" };

export default async function CoworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await openCoworkSession(id);
  if (session.kind === "holding") return <div style={{ padding: 24 }}><h1>{session.line}</h1></div>;
  return (
    <div className="wz as-page as-cowork">
      <CoworkView conversationId={session.conversationId} estimateId={session.estimateId} assistantName={session.assistantName} initialTranscript={session.transcript} initialUi={session.ui} />
    </div>
  );
}
