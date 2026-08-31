import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { getTradeProperty } from "@/lib/portal/tradeData";
import { moneyFmt } from "@/lib/portal/money";
import PropertyTabs from "./PropertyTabs";

export const dynamic = "force-dynamic";

/**
 * Trade portal v2 · Session 3 — the Property screen (brief §5.2): Progress ·
 * Colours · Money · Documents, everything scoped organisation → property.
 * An out-of-scope id is a 404, never a 403 (the token-route rule applies to
 * ids too — don't confirm existence).
 */

// Tom, 31 Aug: QA is OURS — it never renders as a customer-facing stage.
// The quality check folds into On site, exactly like completion_prep.
const RAIL = ["Offer", "Pre-start", "On site", "Walkthrough", "Closed"] as const;
const STAGE_IDX: Record<string, number> = {
  offered: 0, pre_start: 1, in_progress: 2, completion_prep: 2, qa: 2, walkthrough: 3, closed: 4,
};

const COLOUR_CHIP: Record<string, { cls: string; label: string }> = {
  applied: { cls: "emerald", label: "Applied" },
  planned: { cls: "cyan", label: "Scheduled" },
  superseded: { cls: "mut", label: "Previous" },
};

export default async function TradePropertyPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");
  if (!ctx.accounts.some((a) => a.account_type === "trade")) redirect("/account");
  const { viewerTradeRole } = await import("@/lib/portal/approvalData");
  if ((await viewerTradeRole(ctx)) === "finance") redirect("/account/money"); // money and nothing else

  const d = await getTradeProperty(ctx, id, "trade");
  if (!d) notFound();

  const job = d.currentJob;
  const stageIdx = job ? STAGE_IDX[job.stage] ?? 0 : null;
  const currentColours = d.colourCards.filter((c) => c.status !== "superseded");
  const previousColours = d.colourCards.filter((c) => c.status === "superseded");
  const anyLossy = d.colourCards.some((c) => c.lossy);

  const progress = (
    <>
      {job ? (
        <div className="card" data-testid="current-job">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <h3 style={{ margin: 0 }}>{job.woRef ? `Job ${job.woRef} · ` : ""}{job.title}</h3>
          </div>
          <div className="stagerail" aria-hidden>
            {RAIL.map((_, i) => (
              <span key={i} className={stageIdx != null && i < stageIdx ? "done" : i === stageIdx ? "now" : ""} />
            ))}
          </div>
          <div className="raillabels">{RAIL.map((r) => <span key={r}>{r}</span>)}</div>
          <p style={{ fontSize: 13, margin: 0 }}>
            {job.painterFirstName ? <>Painter: <b>{job.painterFirstName}</b> · </> : null}
            {job.startDate ? `Start ${job.startDate}` : "Start to be booked"}
            {job.endDate ? ` · Expected finish ${job.endDate}` : ""}
          </p>
          {job.surfacesTotal > 0 && (
            <p className="sub" style={{ fontSize: 12, marginTop: 4 }} data-testid="surfaces-done">
              Surfaces done: {job.surfacesDone} of {job.surfacesTotal}
            </p>
          )}
          <Link className="btn btn-ghost" style={{ marginTop: 10 }}
            href={`/account/properties/${d.property.id}/jobs/${job.workOrderId}`}>
            Open full timeline →
          </Link>
        </div>
      ) : (
        <div className="card"><p className="sub">No job under way at this property. The full history lives below.</p></div>
      )}

      {d.companyPhone && (
        <div className="card">
          <p className="sub" style={{ margin: 0 }}>
            Questions about this job? Call us on <b style={{ color: "var(--text)" }}>{d.companyPhone}</b>.
          </p>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Job history at this property</h3>
        {d.jobHistory.length === 0 && <p className="sub">No jobs on record yet.</p>}
        {d.jobHistory.map((j, i) => (
          <div key={`${j.woRef}-${i}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{j.title}</b>
              <div className="refline">{j.woRef ?? ""}{j.closedLabel ? ` · ${j.closedLabel}` : j.current ? " · in progress" : ""}</div>
            </div>
            {j.current
              ? <span className="chip cyan nodot">Now</span>
              : j.reportToken
                ? <a className="btn btn-ghost" style={{ padding: "8px 12px", fontSize: 13 }} href={`/s/${j.reportToken}`}>Report</a>
                : null}
          </div>
        ))}
      </div>
    </>
  );

  const colours = (
    <>
      <p className="sub" style={{ fontSize: 12.5, marginBottom: 10 }}>
        The colour card for this property. Updated the moment each surface is finished on site.
      </p>
      {d.coloursTbc && (
        <div className="card" data-testid="property-colours-tbc">
          <span className="chip amber nodot">Colours to be confirmed</span>
          <p className="sub" style={{ marginTop: 8 }}>
            Some colours for the current job are still being decided. They&apos;ll appear here the moment they&apos;re confirmed.
          </p>
        </div>
      )}
      {currentColours.length === 0 && !d.coloursTbc && (
        <div className="card"><p className="sub">No colours on record yet — they&apos;ll appear here the day each surface is finished.</p></div>
      )}
      {currentColours.map((c) => (
        <div className="colourcard" key={c.id} data-testid={`colour-${c.id}`}>
          {c.swatchHex
            ? <div className="chipsw" style={{ background: c.swatchHex }}>{c.colourCode && <em>{c.colourCode}</em>}</div>
            : <div className="chipsw neutral">{c.colourCode && <em>{c.colourCode}</em>}</div>}
          <div className="body">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span className="area">{c.areaLabel}</span>
              <span className={`chip ${COLOUR_CHIP[c.status].cls} nodot`} style={{ flex: "none" }}>{COLOUR_CHIP[c.status].label}</span>
            </div>
            <div className="meta2">
              <b>{[c.brand, c.colourName].filter(Boolean).join(" ")}</b>{c.sheen ? ` · ${c.sheen}` : ""}<br />
              {c.product}{c.coats ? ` · ${c.coats} coats` : ""}
              {c.appliedFrom ? ` · ${c.appliedFrom}${c.appliedTo && c.appliedTo !== c.appliedFrom ? `–${c.appliedTo}` : ""}` : ""}
            </div>
          </div>
        </div>
      ))}
      {previousColours.length > 0 && (
        <>
          <h3 style={{ margin: "14px 0 8px" }}>Previous</h3>
          {previousColours.map((c) => (
            <div className="colourcard prev" key={c.id}>
              {c.swatchHex
                ? <div className="chipsw" style={{ background: c.swatchHex }} />
                : <div className="chipsw neutral" />}
              <div className="body">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span className="area">{c.areaLabel}</span>
                  <span className="chip mut nodot" style={{ flex: "none" }}>
                    Previous{c.appliedFrom ? ` · ${c.appliedFrom.slice(0, 7)}` : ""}
                  </span>
                </div>
                <div className="meta2"><b>{[c.brand, c.colourName].filter(Boolean).join(" ")}</b>{c.sheen ? ` · ${c.sheen}` : ""}</div>
              </div>
            </div>
          ))}
        </>
      )}
      {anyLossy && (
        <p className="note" data-testid="lossy-note" style={{ marginTop: 8 }}>
          Colours from the original estimate — may not show every room.
        </p>
      )}
      <div className="btn-row" style={{ marginTop: 12 }}>
        <a className="btn btn-ghost" href={`/account/properties/${d.property.id}/colour-card`} data-testid="colour-card-pdf">
          Download colour card (PDF)
        </a>
        <Link className="btn btn-ghost" href="/account/new-estimate">Request a touch-up</Link>
      </div>
    </>
  );

  const money = (
    <>
      <div className="tiles" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="tile">
          <div className="num money">{d.money.thisJobTotalCents != null ? moneyFmt(d.money.thisJobTotalCents) : "—"}</div>
          <div className="lb">This job, inc GST</div>
        </div>
        <div className="tile">
          <div className="num em money">{moneyFmt(d.money.paidCents)}</div>
          <div className="lb">Paid so far</div>
        </div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Invoices — this property</h3>
        {d.money.invoices.length === 0 && <p className="sub">Nothing invoiced at this property yet.</p>}
        {d.money.invoices.map((inv, i) => (
          <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13, textTransform: "capitalize" }}>{inv.kind}</b>
              <div className="refline">{inv.number ?? ""}{inv.issuedOn ? ` · issued ${inv.issuedOn}` : ""}</div>
            </div>
            {inv.token
              ? <a className="money" style={{ fontSize: 13, color: inv.paid ? "var(--emerald)" : undefined }} href={`/i/${inv.token}`}>{moneyFmt(inv.totalIncCents)}</a>
              : <span className="money" style={{ fontSize: 13 }}>{moneyFmt(inv.totalIncCents)}</span>}
          </div>
        ))}
      </div>
      <Link className="btn btn-ghost" href="/account/money">Statements &amp; all invoices</Link>
    </>
  );

  const documents = (
    <>
      <div className="card">
        {d.documents.length === 0 && <p className="sub">Completion reports and warranty certificates will land here as jobs finish.</p>}
        {d.documents.map((doc, i) => (
          <div key={doc.href} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{doc.title}</b>
              <div className="refline">{doc.meta}</div>
            </div>
            <a className="btn btn-ghost" style={{ padding: "8px 12px", fontSize: 13 }} href={doc.href}>Open</a>
          </div>
        ))}
      </div>
      <h3 style={{ margin: "14px 0 8px" }}>About Paint Group</h3>
      <div className="card" data-testid="about-paint-group">
        {d.aboutDocs.length === 0 && <p className="sub">Our insurance certificates and warranty terms live here.</p>}
        {d.aboutDocs.map((doc, i) => (
          <div key={doc.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{doc.title}</b>
              <div className="refline">{doc.meta}</div>
            </div>
            <a className="btn btn-ghost" style={{ padding: "8px 12px", fontSize: 13 }} href={`/account/document/${doc.id}`}>Open</a>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div>
      <Link href="/account" className="sub" style={{ display: "inline-block", marginBottom: 8 }}>‹ All properties</Link>
      <div className="greet">Property</div>
      <h1>{d.property.address}</h1>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {d.references.map((r) => (
          <span className="chip mut nodot" key={r.label} data-testid={`ref-${r.label.toLowerCase().replace(/\W+/g, "-")}`}>
            {r.label} · {r.value}
          </span>
        ))}
      </div>
      <PropertyTabs progress={progress} colours={colours} money={money} documents={documents} initialTab={tab} />
    </div>
  );
}
