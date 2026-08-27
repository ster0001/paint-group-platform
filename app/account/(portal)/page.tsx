import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext, getPortalJobs, melbourneGreeting, melbourneTodayYmd } from "@/lib/portal/data";
import { homeState } from "@/lib/portal/home";
import { signout } from "@/app/auth/actions";
import PortfolioHome from "./PortfolioHome";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, { cls: string; label: string }> = {
  draft: { cls: "amber", label: "Being checked" },
  sent: { cls: "cyan", label: "Ready for you" },
  accepted: { cls: "emerald", label: "Accepted" },
  declined: { cls: "mut", label: "Declined" },
};

/** State-aware Home: one headline, one primary action (§4-A3). With a
 * second address the switcher appears and everything else stays identical
 * (§3) — the chips just filter which property's story leads. */
export default async function AccountHomePage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>;
}) {
  const { property: propertyParam } = await searchParams;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  // A trade account gets the portfolio (§6) — same shell, aggregated story.
  if (ctx.accounts.some((a) => a.account_type === "trade")) {
    return <PortfolioHome ctx={ctx} />;
  }

  const all = await getPortalJobs(ctx.accounts.map((a) => a.id));
  const selected = ctx.properties.find((p) => p.id === propertyParam)?.id ?? null;
  const estimates = selected ? all.estimates.filter((e) => e.property_id === selected) : all.estimates;
  const workOrders = all.workOrders;
  const state = homeState(estimates, workOrders, melbourneTodayYmd(), ctx.companyPhone || "");
  const isTel = state.cta.href.startsWith("tel:");

  const primaryProperty = ctx.properties.find((p) => p.id === selected) ?? ctx.properties[0] ?? null;
  const wizardHref = primaryProperty ? `/estimate?property=${primaryProperty.id}` : "/estimate";
  const propertyLabel = (p: { address: string | null; suburb: string | null }) =>
    p.address?.trim() || p.suburb?.trim() || "My address";

  return (
    <div>
      <div className="greet">{melbourneGreeting()}{ctx.firstName ? `, ${ctx.firstName}` : ""}</div>
      <h1>{state.headline}</h1>

      {ctx.properties.length >= 2 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 16px" }}>
          <Link href="/account" className={`chip ${selected ? "mut" : "cyan"} nodot`}>Everything</Link>
          {ctx.properties.map((p) => (
            <Link
              key={p.id}
              href={`/account?property=${p.id}`}
              className={`chip ${selected === p.id ? "cyan" : "mut"} nodot`}
            >
              {propertyLabel(p)}
            </Link>
          ))}
        </div>
      )}

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
              <Link key={e.id} href={`/e/${e.share_token}?portal=1`} className="job">{body}</Link>
            ) : (
              <div key={e.id} className="job">{body}</div>
            );
          })}
        </>
      )}

      <h2>Thinking about more painting?</h2>
      <div className="card">
        <p className="sub" style={{ marginBottom: 14 }}>
          {primaryProperty
            ? <>Price another job at <b style={{ color: "var(--text)" }}>{propertyLabel(primaryProperty)}</b> — we already know the address, so you start closer to a price.</>
            : <>Answer a few questions about your home and see your estimate in minutes.</>}
        </p>
        <div className="btn-row" style={{ marginTop: 0 }}>
          <Link className="btn btn-ghost" href={wizardHref}>Get a new estimate</Link>
          <Link className="btn btn-ghost" href="/account/addresses/new">Add an address</Link>
        </div>
      </div>

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
