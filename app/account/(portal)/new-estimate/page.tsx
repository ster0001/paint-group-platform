import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext, getRebookCandidates } from "@/lib/portal/data";
import { moneyFmt } from "@/lib/portal/money";

export const dynamic = "force-dynamic";

/**
 * 3a-7 · New estimate (§6 W2): the trade account's fast lane — repeat a
 * previous job in one tap (the prior answers seed the wizard), start from a
 * saved property, or from scratch. Unlimited, always (decided). Named
 * saved-spec templates are a deliberate follow-up — rebook covers the
 * end-of-lease-in-2-minutes promise without a second store of specs.
 */
export default async function NewEstimatePage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");
  if (!ctx.accounts.some((a) => a.account_type === "trade")) redirect("/account");

  const accountIds = ctx.accounts.map((a) => a.id);
  const rebooks = await getRebookCandidates(accountIds);
  const orgName = ctx.accounts.find((a) => a.account_type === "trade")?.name ?? "";
  const propertyById = new Map(ctx.properties.map((p) => [p.id, p]));
  const label = (pid: string | null, fallback: string | null) => {
    const p = pid ? propertyById.get(pid) : null;
    return p?.address?.trim() || fallback?.trim() || "A previous job";
  };

  const repeatable = rebooks.filter((r) => r.hasWizard && ["accepted", "declined", "sent"].includes(r.status)).slice(0, 4);
  const drafts = rebooks.filter((r) => r.status === "draft").slice(0, 6);

  return (
    <div>
      <div className="greet">{orgName || "Your account"}</div>
      <h1>New estimate</h1>

      <div className="card raised">
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Trade account</h3>
          <span className="chip cyan nodot">Unlimited estimates</span>
        </div>
        <p className="sub">Quote any property in a couple of minutes — floorplans always on, no limits.</p>
      </div>

      {repeatable.length > 0 && (
        <>
          <h2>Fastest — repeat a previous job</h2>
          {repeatable.map((r) => (
            <div className="job" key={r.id}>
              <div className="addr">{label(r.property_id, r.title)}</div>
              <div className="meta">
                Same answers as last time — the wizard only asks what&rsquo;s changed
                {r.total_cents ? <> · was <span className="money" style={{ fontSize: 13 }}>{moneyFmt(r.total_cents)}</span></> : null}
              </div>
              <div className="btn-row">
                <Link
                  className="btn btn-cyan"
                  style={{ padding: 12, fontSize: 15, flex: 1 }}
                  href={`/estimate?${r.property_id ? `property=${r.property_id}&` : ""}rebook=${r.id}`}
                >
                  Requote this in one tap
                </Link>
              </div>
            </div>
          ))}
        </>
      )}

      <h2>Or from scratch</h2>
      {ctx.properties.slice(0, 6).map((p) => (
        <Link className="job" key={p.id} href={`/estimate?property=${p.id}`}>
          <div className="row">
            <div className="addr">{[p.address, p.suburb].filter(Boolean).join(", ")}</div>
            <span className="chip mut nodot">Start here</span>
          </div>
        </Link>
      ))}
      <Link className="btn btn-cyan" href="/estimate" style={{ marginTop: 6 }}>
        New property — start the wizard
      </Link>

      {drafts.length > 0 && (
        <>
          <h2>Your drafts</h2>
          {drafts.map((d) => (
            <div className="job" key={d.id}>
              <div className="row">
                <div className="addr">{label(d.property_id, d.title)}</div>
                <span className="chip amber nodot">Draft</span>
              </div>
              <div className="meta">We&rsquo;re looking at it — it stays saved here.</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
