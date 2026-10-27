import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { getPortalThreads } from "@/lib/portal/messages";
import StartConversation from "./StartConversation";

export const dynamic = "force-dynamic";

function preview(body: string): string {
  const one = body.replace(/\s+/g, " ").trim();
  return one.length > 90 ? `${one.slice(0, 90)}…` : one;
}

/**
 * Messages — one thread per estimate, the SAME live chat the estimate page
 * carries (and the invoice rides the estimate, so it's one messenger for
 * both). Kept next to the project so "where did they say that?" always has
 * one answer.
 *
 * Portal UX brief (25 Oct 2026): only threads with something in them list
 * (G1); the badge is unread replies, cyan, gone at zero, and an unread
 * preview reads bold (G2); every row is a whole-card link (B4).
 */
export default async function MessagesPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const threads = await getPortalThreads(ctx.accounts.map((a) => a.id));
  const live = threads.filter((t) => t.messages.length > 0);
  const quiet = threads.filter((t) => t.messages.length === 0);
  const phone = ctx.companyPhone;

  return (
    <div>
      <h1>Messages</h1>
      <div className="card raised">
        <p className="sub">
          Every conversation about your estimates and invoices, kept here next to your
          project. Write to us any time — a person answers.
        </p>
      </div>

      <StartConversation options={quiet.map((t) => ({ estimateId: t.estimateId, title: t.title }))} />

      {live.length === 0 && quiet.length === 0 && (
        <div className="card">
          <p className="sub">
            Nothing here yet — your first conversation starts from an estimate, and it will
            be kept here for good.
          </p>
        </div>
      )}
      {live.length === 0 && quiet.length > 0 && (
        <div className="card">
          <p className="sub">No messages yet — pick an estimate above and say hello.</p>
        </div>
      )}

      {live.map((t) => {
        const last = t.messages[t.messages.length - 1];
        return (
          <Link key={t.estimateId} href={`/account/messages/${t.estimateId}`} className="job tap" data-testid="thread-row">
            <div className="job-main">
              <div className="addr">{t.title}</div>
              <div className={`meta${t.unread > 0 ? " unread" : ""}`} data-testid="thread-preview">
                {`${last.direction === "customer" ? "You" : (last.author_name?.trim() || "Paint Group")}: ${preview(last.body)}`}
              </div>
            </div>
            <div className="job-side">
              {t.unread > 0 && <span className="badge" data-testid="unread-badge" aria-label={`${t.unread} unread`}>{t.unread}</span>}
              <span className="chev" aria-hidden="true">›</span>
            </div>
          </Link>
        );
      })}

      {phone && (
        <>
          <h2>Prefer to talk?</h2>
          <div className="card">
            <p className="sub" style={{ marginBottom: 14 }}>
              Ring us on <b style={{ color: "var(--ink)" }}>{phone}</b> — we&rsquo;re happy to
              talk anything through.
            </p>
            <a className="btn btn-ghost" href={`tel:${phone.replace(/\s+/g, "")}`}>Call us now</a>
          </div>
        </>
      )}
    </div>
  );
}
