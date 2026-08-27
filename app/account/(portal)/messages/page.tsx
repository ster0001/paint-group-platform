import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { getPortalThreads } from "@/lib/portal/messages";

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
 */
export default async function MessagesPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const threads = await getPortalThreads(ctx.accounts.map((a) => a.id));
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

      {threads.length === 0 ? (
        <div className="card">
          <p className="sub">
            Nothing here yet — your first conversation starts from an estimate, and it will
            be kept here for good.
          </p>
        </div>
      ) : (
        threads.map((t) => {
          const last = t.messages[t.messages.length - 1];
          return (
            <Link key={t.estimateId} href={`/account/messages/${t.estimateId}`} className="job">
              <div className="row">
                <div>
                  <div className="addr">{t.title}</div>
                  <div className="meta">
                    {last
                      ? `${last.direction === "customer" ? "You" : (last.author_name?.trim() || "Paint Group")}: ${preview(last.body)}`
                      : "No messages yet — start the conversation"}
                  </div>
                </div>
                {t.messages.length > 0 && <span className="chip mut nodot">{t.messages.length}</span>}
              </div>
            </Link>
          );
        })
      )}

      {phone && (
        <>
          <h2>Prefer to talk?</h2>
          <div className="card">
            <p className="sub" style={{ marginBottom: 14 }}>
              Ring us on <b style={{ color: "var(--text)" }}>{phone}</b> — we&rsquo;re happy to
              talk anything through.
            </p>
            <a className="btn btn-ghost" href={`tel:${phone.replace(/\s+/g, "")}`}>Call us now</a>
          </div>
        </>
      )}
    </div>
  );
}
