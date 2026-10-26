import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext, getPortalJobs, melbourneGreeting, melbourneTodayYmd, portalBrandOf } from "@/lib/portal/data";
import { homeState } from "@/lib/portal/home";
import { addressChips, groupEstimates, type HomeCard, type OpenWizard } from "@/lib/portal/homeList";
import { createServiceClient } from "@/lib/supabase/service";
import { pageLabel } from "@/lib/wizard/journey";
import { findOpenDraft } from "@/lib/wizard/draftOwner";
import { signout } from "@/app/auth/actions";
import TradePortfolioHome from "./TradePortfolioHome";

export const dynamic = "force-dynamic";

/** State-aware Home: one headline, one primary action (§4-A3). With a
 * second address the switcher appears and everything else stays identical
 * (§3) — the chips just filter which property's story leads. The estimate
 * list reads Needs you / With us / Done (portal UX brief C3, 25 Oct 2026). */
export default async function AccountHomePage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; all?: string }>;
}) {
  const { property: propertyParam, all: allParam } = await searchParams;
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
  const portalMixed = portalBrandOf(all.estimates).mixed;
  // C2: identical addresses are one chip; the four most active lead, the
  // rest sit behind "More (n)". A chip stands for every merged id.
  const selectedParam = ctx.properties.find((p) => p.id === propertyParam)?.id ?? null;
  const strip = addressChips(ctx.properties, all.estimates, selectedParam, allParam === "1");
  const estimates = strip.selectedIds
    ? all.estimates.filter((e) => e.property_id && strip.selectedIds!.includes(e.property_id))
    : all.estimates;
  const workOrders = all.workOrders;
  // Tom, 7 Sep: a half-finished wizard walk (the autosaved session for this
  // signed-in user) is the way back in — "pick up where I left off".
  // Tom, 7 Sep (evening): the walk may have been left by the ANONYMOUS
  // session that started it — the account / verified-email door finds it
  // (lib/wizard/draftOwner). Reading it writes nothing: bucket, dropped_at
  // and the 45-minute "online now / dropped" rule stay the funnel's.
  let openWizard: OpenWizard | null = null;
  const svcForDraft = createServiceClient();
  if (svcForDraft) {
    const found = await findOpenDraft(svcForDraft, { userId: ctx.userId, verifiedEmail: ctx.email }, new Date());
    const d = found?.row;
    if (d && d.last_seen_at && (Number(d.furthest_page) || 1) > 1) {
      openWizard = {
        pageLabel: pageLabel(d.job_type, Number(d.current_page) || Number(d.furthest_page) || 1),
        where: (d.address || d.suburb || "").trim(),
        lastSeen: d.last_seen_at,
      };
    }
  }
  const today = melbourneTodayYmd();
  const state = homeState(estimates, workOrders, today, ctx.companyPhone || "", openWizard);
  const isTel = state.cta.href.startsWith("tel:");
  const groups = groupEstimates(estimates, workOrders, openWizard, today, portalMixed);
  const anyEstimates = groups.needsYou.length + groups.withUs.length + groups.done.length > 0;

  const chipHref = (id: string | null) => {
    const q = new URLSearchParams();
    if (id) q.set("property", id);
    if (allParam === "1") q.set("all", "1");
    const s = q.toString();
    return `/account${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <div className="greet">{melbourneGreeting()}{ctx.firstName ? `, ${ctx.firstName}` : ""}</div>
      <h1>{state.headline}</h1>

      {ctx.properties.length >= 2 && (
        <div className="strip" data-testid="address-strip">
          <Link href={chipHref(null)} className={`addr-chip${strip.selectedIds ? "" : " on"}`}>Everything</Link>
          {strip.shown.map((c) => (
            <Link
              key={c.id}
              href={chipHref(c.id)}
              className={`addr-chip${strip.selectedIds && strip.selectedIds.includes(c.id) ? " on" : ""}`}
              data-testid="address-chip"
            >
              {c.label}{c.count > 1 ? <span className="n"> · {c.count}</span> : null}
            </Link>
          ))}
          {strip.hidden.length > 0 && (
            <Link href={`/account?all=1${selectedParam ? `&property=${selectedParam}` : ""}`} className="addr-chip more" data-testid="address-more">
              More ({strip.hidden.length})
            </Link>
          )}
          {allParam === "1" && ctx.properties.length > 5 && (
            <Link href={chipHref(selectedParam).replace(/[?&]all=1/, "").replace(/\?$/, "")} className="addr-chip more" data-testid="address-fewer">
              Fewer
            </Link>
          )}
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

      {anyEstimates && (
        <>
          {groups.needsYou.length > 0 && (
            <section data-testid="group-needs-you">
              <h2>Needs you</h2>
              {groups.needsYou.map((c) => <EstimateCard key={c.key} card={c} />)}
            </section>
          )}
          {groups.withUs.length > 0 && (
            <section data-testid="group-with-us">
              <h2>With us</h2>
              {groups.withUs.map((c) => <EstimateCard key={c.key} card={c} />)}
            </section>
          )}
          {groups.done.length > 0 && (
            // C3: Done is collapsed by default — the native disclosure needs no script.
            <details className="group" data-testid="group-done" open={groups.needsYou.length + groups.withUs.length === 0}>
              <summary><h2>Done <span className="count">· {groups.done.length}</span></h2></summary>
              {groups.done.map((c) => <EstimateCard key={c.key} card={c} />)}
            </details>
          )}
        </>
      )}

      <h2>Thinking about more painting?</h2>
      <div className="card">
        <p className="sub" style={{ marginBottom: 14 }}>
          Answer a few questions about the property and see your estimate in minutes.
        </p>
        {/* C4 (locked default): one button, address step first. "Add a property" stays
            because it has its own job — registering an address with no estimate yet. */}
        <Link className="btn btn-ghost" href="/estimate">Get an estimate for another property</Link>
        <Link href="/account/addresses/new" className="sub" style={{ display: "block", textAlign: "center", marginTop: 12, textDecoration: "underline" }}>
          Add a property (no estimate yet)
        </Link>
      </div>

      <h2>Documents &amp; warranty</h2>
      <Link href="/account/documents" className="job tap" data-testid="documents-card">
        <div className="job-main">
          <div className="addr">Your documents</div>
          <div className="meta">Warranty card, our insurance certificates, completion reports</div>
        </div>
        <span className="chev" aria-hidden="true">›</span>
      </Link>

      <h2>Prefer to talk?</h2>
      <div className="card">
        <p className="sub" style={{ marginBottom: ctx.companyPhone ? 14 : 0 }}>
          {ctx.companyPhone ? (
            <>You can always ring us on <b style={{ color: "var(--ink)" }}>{ctx.companyPhone}</b> — a person answers, and we&rsquo;re happy to talk anything through.</>
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

/** One estimate card: address, status chip, the one-line next step and a
 * relative date (C3) — the whole card is the link when there is one (B4). */
function EstimateCard({ card }: { card: HomeCard }) {
  const body = (
    <>
      <div className="job-main">
        <div className="addr">{card.title}</div>
        <div className="meta" data-testid={card.history ? "portal-history" : undefined}>{card.next}</div>
        {card.when && <div className="when">{card.when}</div>}
      </div>
      <div className="job-side">
        {card.paintHome && <span className="chip mut nodot" data-testid="job-brand">Paint Home</span>}
        <span className={`chip ${card.chip.cls}`}>{card.chip.label}</span>
        {card.href && <span className="chev" aria-hidden="true">›</span>}
      </div>
    </>
  );
  return card.href ? (
    <Link href={card.href} className="job tap" data-testid={card.testId}>{body}</Link>
  ) : (
    <div className="job tap" data-testid={card.testId}>{body}</div>
  );
}
