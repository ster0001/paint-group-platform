import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { getPortalThreads } from "@/lib/portal/messages";
import { createServiceClient } from "@/lib/supabase/service";
import { sendPortalMessageAction } from "../actions";

export const dynamic = "force-dynamic";

const timeFmt = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Melbourne",
  day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
});

/** One conversation — the same thread the estimate page's live chat shows. */
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
      ? (await svc.from("estimates").select("id, title")
          .eq("id", estimateId)
          .in("account_id", ctx.accounts.map((a) => a.id))
          .maybeSingle()).data as { id: string; title: string | null } | null
      : null;
    if (!owned) notFound();
    thread = {
      estimateId: owned.id,
      title: owned.title?.trim() || "Your job",
      shareToken: null,
      hasInvoice: false,
      messages: [],
      lastAt: null,
    };
  }

  return (
    <div>
      <Link href="/account/messages" className="note" style={{ display: "inline-block", marginBottom: 14 }}>
        ← All messages
      </Link>
      <h1>{thread.title}</h1>
      <p className="note" style={{ marginBottom: 16 }}>
        {thread.hasInvoice
          ? "One conversation for this job — estimate and invoice questions both land here."
          : "One conversation for this job — it also appears on your estimate page."}
        {thread.shareToken && (
          <>
            {" "}
            <Link href={`/e/${thread.shareToken}?portal=1#chat`} style={{ color: "var(--cyan)" }}>
              Open the estimate
            </Link>
          </>
        )}
      </p>

      {thread.messages.length === 0 ? (
        <div className="card">
          <p className="sub">No messages yet — say hello below and we&rsquo;ll get back to you.</p>
        </div>
      ) : (
        <div className="msgs">
          {thread.messages.map((m) => (
            <div key={m.id} className={`msg ${m.direction === "customer" ? "mine" : "theirs"}`}>
              <div className="msg-body">{m.body}</div>
              <div className="msg-meta">
                {m.direction === "customer" ? "You" : (m.author_name?.trim() || "Paint Group")}
                {" · "}
                {timeFmt.format(new Date(m.created_at))}
              </div>
            </div>
          ))}
        </div>
      )}

      {error === "send" && (
        <div className="card" style={{ borderColor: "rgba(224,168,60,.5)" }}>
          <p className="sub">That message didn&rsquo;t send — please try again.</p>
        </div>
      )}

      <form action={sendPortalMessageAction} className="card" style={{ marginTop: 16 }}>
        <input type="hidden" name="estimateId" value={thread.estimateId} />
        <label htmlFor="msg-body" className="note" style={{ display: "block", marginBottom: 8 }}>
          Write a message
        </label>
        <textarea
          id="msg-body"
          className="field"
          name="body"
          rows={3}
          required
          maxLength={4000}
          placeholder="Type here — we usually reply the same business day."
        />
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-cyan" type="submit">Send</button>
        </div>
      </form>
    </div>
  );
}
