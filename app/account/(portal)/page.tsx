import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext, getPortalJobs, melbourneGreeting, melbourneTodayYmd } from "@/lib/portal/data";
import { homeState } from "@/lib/portal/home";
import { signout } from "@/app/auth/actions";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, { cls: string; label: string }> = {
  draft: { cls: "amber", label: "Being checked" },
  sent: { cls: "cyan", label: "Ready for you" },
  accepted: { cls: "emerald", label: "Accepted" },
  declined: { cls: "mut", label: "Declined" },
};

/** State-aware Home: one headline, one primary action (§4-A3). */
export default async function AccountHomePage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const { estimates, workOrders } = await getPortalJobs(ctx.accounts.map((a) => a.id));
  const state = homeState(estimates, workOrders, melbourneTodayYmd(), ctx.companyPhone || "");
  const isTel = state.cta.href.startsWith("tel:");

  return (
    <div>
      <div className="greet">{melbourneGreeting()}{ctx.firstName ? `, ${ctx.firstName}` : ""}</div>
      <h1>{state.headline}</h1>

      <div className="card raised">
        {state.chip && (
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="chip cyan">{state.chip}</span>
          </div>
        )}
        <div className="big">{state.sub}</div>
        <div style={{ marginTop: 16 }}>
          {isTel ? (
            <a className="btn btn-cyan" href={state.cta.href}>{state.cta.label}</a>
          ) : (
            <Link className="btn btn-cyan" href={state.cta.href}>{state.cta.label}</Link>
          )}
        </div>
      </div>

      {estimates.length > 0 && (
        <>
          <h2>My estimates</h2>
          {estimates.slice(0, 8).map((e) => {
            const chip = STATUS_CHIP[e.status] ?? { cls: "mut", label: e.status };
            const open = e.status !== "draft" && e.share_token && e.sent_at;
            const body = (
              <>
                <div className="row">
                  <div className="addr">{e.title?.trim() || "Your estimate"}</div>
                  <span className={`chip ${chip.cls}`}>{chip.label}</span>
                </div>
                {open ? <div className="meta">Tap to open it</div> : null}
              </>
            );
            return open ? (
              <Link key={e.id} href={`/e/${e.share_token}`} className="job">{body}</Link>
            ) : (
              <div key={e.id} className="job">{body}</div>
            );
          })}
        </>
      )}

      <h2>Documents &amp; warranty</h2>
      <Link href="/account/documents" className="job">
        <div className="row">
          <div>
            <div className="addr">Your documents</div>
            <div className="meta">Warranty card, our insurance certificates, completion reports</div>
          </div>
          <span className="chip mut nodot">Open</span>
        </div>
      </Link>

      <h2>Prefer to talk?</h2>
      <div className="card">
        <p className="sub" style={{ marginBottom: ctx.companyPhone ? 14 : 0 }}>
          {ctx.companyPhone ? (
            <>You can always ring us on <b style={{ color: "var(--text)" }}>{ctx.companyPhone}</b> — a person answers, and we&rsquo;re happy to talk anything through.</>
          ) : (
            <>We&rsquo;re always happy to talk anything through — reply to any of our emails and a person answers.</>
          )}
        </p>
        {ctx.companyPhone && (
          <a className="btn btn-ghost" href={`tel:${ctx.companyPhone.replace(/\s+/g, "")}`}>Call us now</a>
        )}
      </div>

      <form action={signout} style={{ marginTop: 28, textAlign: "center" }}>
        <button type="submit" className="note" style={{ textDecoration: "underline" }}>Sign out</button>
      </form>
    </div>
  );
}
