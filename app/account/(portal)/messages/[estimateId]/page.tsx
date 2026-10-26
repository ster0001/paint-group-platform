import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { getPortalThreads, markPortalThreadOpened } from "@/lib/portal/messages";
import { createServiceClient } from "@/lib/supabase/service";
import { sendPortalMessageAction } from "../actions";

export const dynamic = "force-dynamic";

const timeFmt = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Melbourne",
  day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
});

const STATUS_CHIP: Record<string, { cls: string; label: string }> = {
  draft: { cls: "amber", label: "Being checked" },
  sent: { cls: "cyan", label: "Ready for you" },
  accepted: { cls: "emerald", label: "Accepted" },
  declined: { cls: "mut", label: "Declined" },
};

/** One conversation — the same thread the estimate page's live chat shows.
 * Portal UX brief G3 (25 Oct 2026): address + status chip + "Open the
 * estimate" in the header, the assistant as a secondary button, sender and
 * time on one meta line, an initial on every staff bubble, and a composer
 * that sticks above the tab bar while the thread scrolls behind it. */
export default async function MessageThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ estimateId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ estimateId }, { error }] = await Promise.all([params, searchParams]);
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const threads = await getPortalThreads(ctx.accounts.map((a) => a.id));
  let thread = threads.find((t) => t.estimateId === estimateId);
  if (!thread) {
    // The timeline's "Message me" button (Tom, 1 Sep) can arrive before a
    // thread exists (an estimate that never went through a send). If the
    // estimate is genuinely THEIRS, open an empty conversation rather than a
    // dead end — the compose action runs its own ownership check anyway.
    const svc = createServiceClient();
    const owned = svc
      ? (await svc.from("estimates").select("id, title, status")
          .eq("id", estimateId)
          .in("account_id", ctx.accounts.map((a) => a.id))
          .maybeSingle()).data as { id: string; title: string | null; status: string } | null
      : null;
    if (!owned) notFound();
    thread = {
      estimateId: owned.id,
      title: owned.title?.trim() || "Your job",
      status: owned.status,
      shareToken: null,
      hasInvoice: false,
      messages: [],
      lastAt: null,
      unread: 0,
    };
  }
  // Opening the thread is reading it (G2) — after the read, so the page the
  // customer sees is the one they are stamping.
  if (thread.unread > 0) await markPortalThreadOpened(thread.estimateId);

  const chip = STATUS_CHIP[thread.status] ?? null;
  const initialOf = (name: string | null) => (name?.trim() || "P")[0]!.toUpperCase();

  return (
    <div className="thread">
      <Link href="/account/messages" className="sub" style={{ display: "inline-block", marginBottom: 10 }}>
        ‹ All messages
      </Link>
      <div className="row thread-head">
        <h1 style={{ margin: 0 }}>{thread.title}</h1>
        {chip && <span className={`chip ${chip.cls}`} data-testid="thread-status">{chip.label}</span>}
      </div>
      <div className="acts" style={{ margin: "10px 0 16px" }}>
        {thread.shareToken && (
          <Link href={`/e/${thread.shareToken}?portal=1#chat`} className="btn btn-ghost sm" data-testid="open-estimate">
            Open the estimate
          </Link>
        )}
        <Link href={`/account/assist/${thread.estimateId}`} className="btn btn-ghost sm" data-testid="ask-assistant">
          Ask the assistant
        </Link>
      </div>
      <p className="sub" style={{ marginBottom: 14 }}>
        {thread.hasInvoice
          ? "One conversation for this job — estimate and invoice questions both land here."
          : "One conversation for this job — it also appears on your estimate page."}
      </p>

      {thread.messages.length === 0 ? (
        <div className="card">
          <p className="sub">No messages yet — say hello below and we&rsquo;ll get back to you.</p>
        </div>
      ) : (
        <div className="msgs">
          {thread.messages.map((m) => (
            <div key={m.id} className={`msg ${m.direction === "customer" ? "mine" : "theirs"}`}>
              {m.direction === "staff" && (
                <span className="msg-av" aria-hidden="true" data-testid="staff-initial">{initialOf(m.author_name)}</span>
              )}
              <div className="msg-bubble">
                <div className="msg-body">{m.body}</div>
                <div className="msg-meta">
                  {m.direction === "customer" ? "You" : (m.author_name?.trim() || "Paint Group")}
                  {" · "}
                  {timeFmt.format(new Date(m.created_at))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error === "send" && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <p className="sub">That message didn&rsquo;t send — please try again.</p>
        </div>
      )}

      <form action={sendPortalMessageAction} className="composer" data-testid="composer">
        <input type="hidden" name="estimateId" value={thread.estimateId} />
        <textarea
          id="msg-body"
          className="field"
          name="body"
          rows={2}
          required
          maxLength={4000}
          aria-label="Write a message"
          placeholder="Type here — we usually reply the same business day."
        />
        <button className="btn btn-cyan" type="submit">Send</button>
      </form>
    </div>
  );
}
