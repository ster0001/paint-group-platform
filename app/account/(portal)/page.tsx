import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext, getPortalJobs, melbourneGreeting, melbourneTodayYmd } from "@/lib/portal/data";
import { homeState } from "@/lib/portal/home";
import { createServiceClient } from "@/lib/supabase/service";
import { pageLabel } from "@/lib/wizard/journey";
import { signout } from "@/app/auth/actions";
import TradePortfolioHome from "./TradePortfolioHome";

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

  // A trade account gets the property-spine portfolio (trade portal v2 §5.1);
  // a finance seat lands on the money view and nothing else (§5.6).
  if (ctx.accounts.some((a) => a.account_type === "trade")) {
    const { viewerTradeRole } = await import("@/lib/portal/approvalData");
    if ((await viewerTradeRole(ctx)) === "finance") redirect("/account/money");
    return <TradePortfolioHome ctx={ctx} />;
  }

  const all = await getPortalJobs(ctx.accounts.map((a) => a.id));
  const selected = ctx.properties.find((p) => p.id === propertyParam)?.id ?? null;
  const estimates = selected ? all.estimates.filter((e) => e.property_id === selected) : all.estimates;
  const workOrders = all.workOrders;
  // Tom, 7 Sep: a half-finished wizard walk (the autosaved session for this
  // signed-in user) is the way back in — "pick up where I left off".
  let openWizard: { pageLabel: string } | null = null;
  const svcForDraft = createServiceClient();
  if (svcForDraft) {
    const { data: d } = await svcForDraft.from("wizard_drafts").select("job_type, current_page, furthest_page, last_seen_at")
      .eq("user_id", ctx.userId).is("converted_at", null).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
    if (d && d.last_seen_at && new Date().getTime() - new Date(d.last_seen_at as string).getTime() < 7 * 24 * 3600_000 && (Number(d.furthest_page) || 1) > 1) {
      openWizard = { pageLabel: pageLabel(d.job_type as string | null, Number(d.current_page) || Number(d.furthest_page) || 1) };
    }
  }
  const state = homeState(estimates, workOrders, melbourneTodayYmd(), ctx.companyPhone || "", openWizard);
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
          Answer a few questions about the property and see your estimate in minutes.
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
