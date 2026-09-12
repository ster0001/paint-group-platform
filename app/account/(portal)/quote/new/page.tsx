import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { moneyFmt } from "@/lib/portal/money";
import { loadTradeSpecs } from "@/lib/wizard/trade-specs";
import { specSummary } from "@/lib/wizard/saved-specs";
import { parseMeasuredTree, measuredTreeIsStale, measuredTreeMaxAgeDays } from "@/lib/wizard/measured-tree";
import { blocksForSpec, fileFacts, tradeQuoteState } from "@/lib/wizard/trade-quote";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { customerRange, editorPayload } from "@/lib/wizard/view";
import { bandsFromSettings, settingValue } from "@/lib/wizard/policy";
import { latestColours } from "@/lib/portal/colours-on-file";
import OpenSheet from "./OpenSheet";

export const dynamic = "force-dynamic";

/**
 * C15 · walk A · screen A2 — NEW QUOTE.
 *
 * Pick the property, then the spec. A known property shows its file — last
 * painted, areas measured, colours, access — and the line "everything here
 * carries into the quote; you'll only be asked what's changed". Because the
 * property is measured and the spec is saved, a range renders BEFORE the
 * sheet is opened: the file's blocks, filtered to the spec, priced by the
 * same `editorPayload` + `customerRange` every other range goes through.
 * A property with no file falls back to the guided wizard (⚑12).
 */
export default async function TradeNewQuotePage({ searchParams }: { searchParams: Promise<{ property?: string; spec?: string }> }) {
  const { property: propertyParam, spec: specParam } = await searchParams;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");
  const trade = ctx.accounts.find((a) => a.account_type === "trade");
  if (!trade) redirect("/account");
  const svc = createServiceClient();
  if (!svc) return <div className="card"><p className="sub">The quote screen is unavailable right now — try again shortly.</p></div>;

  const accountIds = ctx.accounts.map((a) => a.id);
  const specs = await loadTradeSpecs(svc, accountIds);
  const property = propertyParam && /^[0-9a-f-]{36}$/.test(propertyParam)
    ? ctx.properties.find((p) => p.id === propertyParam) ?? null
    : null;

  // The file: measured tree, colours, access — only for the member's own property.
  let file: {
    id: string; address: string; suburb: string | null; state: string | null; postcode: string | null; accessNotes: string | null;
    tree: ReturnType<typeof parseMeasuredTree>; stale: boolean; maxAgeDays: number;
    colours: Array<{ surface: string; name: string; when: string | null }>;
  } | null = null;
  if (property) {
    const [{ data: row }, { data: ageRow }, colours] = await Promise.all([
      svc.from("properties").select("id, address, suburb, state, postcode, access_notes, measured_tree, measured_at").eq("id", property.id).maybeSingle(),
      svc.from("settings").select("value").eq("key", "measured_tree_max_age_days").maybeSingle(),
      latestColours(svc, property.id),
    ]);
    if (row) {
      const tree = parseMeasuredTree(row.measured_tree, row.measured_at as string | null);
      const maxAgeDays = measuredTreeMaxAgeDays((ageRow as { value?: unknown } | null)?.value);
      file = {
        id: row.id as string, address: (row.address as string | null) ?? property.address ?? "Your property",
        suburb: (row.suburb as string | null) ?? null, state: (row.state as string | null) ?? null, postcode: (row.postcode as string | null) ?? null,
        accessNotes: (row.access_notes as string | null) ?? null,
        tree, stale: tree ? measuredTreeIsStale(tree, maxAgeDays) : false, maxAgeDays, colours,
      };
    }
  }

  const spec = specParam ? specs.find((s) => s.id === specParam) ?? null : null;
  const facts = fileFacts(file?.tree ?? null);

  // The range from the file — server-side, the two calls every range uses.
  let range: { lo: number; hi: number; bandPct: number } | null = null;
  if (file?.tree) {
    const blocks = blocksForSpec(file.tree, spec);
    if (blocks.some((b) => (b.surfaces ?? []).length > 0)) {
      const pctx = await loadPricingContext(svc);
      const payload = editorPayload(blocks, pctx, adjustmentsFrom({}), []);
      const r = customerRange(payload, bandsFromSettings(settingValue(pctx.settings, "wizard_bands")));
      range = { lo: r.rangeLoCents, hi: r.rangeHiCents, bandPct: r.bandPct };
    }
  }

  const contact = { name: ctx.firstName ?? "", email: ctx.email, phone: trade.phone ?? "" };
  const state = file ? tradeQuoteState(file, spec, contact) : null;
  const specHref = (id: string | null) => `/account/quote/new?${new URLSearchParams({ ...(property ? { property: property.id } : {}), ...(id ? { spec: id } : {}) }).toString()}`;

  return (
    <div data-testid="trade-new-quote">
      <Link href="/account" className="sub" style={{ display: "inline-block", marginBottom: 8 }}>‹ Home</Link>
      <h1>New quote</h1>
      <p className="sub">Pick the property, then the spec. Both are optional — a new address and a blank sheet works too.</p>

      <h2>Property</h2>
      {file ? (
        <div className="card" data-testid="property-file">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 600 }}>{[file.address, file.suburb].filter(Boolean).join(", ")}</div>
            <span className={`chip ${file.tree ? "emerald" : "mut"} nodot`}>{file.tree ? "On file" : "No file yet"}</span>
          </div>
          {file.tree ? (
            <dl className="file-facts" style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 14 }}>
              <dt className="sub">Last painted</dt><dd style={{ margin: 0 }} data-testid="file-last-painted">{facts.measuredLabel ?? "date unknown"}</dd>
              <dt className="sub">Rooms measured</dt><dd style={{ margin: 0 }} data-testid="file-areas">{facts.areas} area{facts.areas === 1 ? "" : "s"}, measured on site</dd>
              <dt className="sub">Colours</dt>
              <dd style={{ margin: 0 }} data-testid="file-colours">
                {file.colours.length ? file.colours.map((c) => `${c.surface} ${c.name}`).join(" · ") : "none on the register yet"}
              </dd>
              <dt className="sub">Access</dt><dd style={{ margin: 0 }}>{file.accessNotes?.trim() || "nothing noted"}</dd>
            </dl>
          ) : (
            <p className="sub" style={{ marginTop: 8 }}>
              Nobody has measured this one yet. The guided walk asks the rooms once; after the first confirmed price the file is kept.
            </p>
          )}
          {file.tree && (
            <p className="sub" style={{ marginTop: 10 }}>
              Everything here carries into the quote. You&rsquo;ll only be asked what&rsquo;s changed.
            </p>
          )}
          {file.stale && (
            <p className="sub" style={{ marginTop: 6 }} data-testid="file-stale">
              Measured more than {file.maxAgeDays} days ago — the file still seeds the sheet, and the range is a little wider until someone has looked again.
            </p>
          )}
        </div>
      ) : (
        <div className="card">
          {ctx.properties.length ? (
            <div>
              {ctx.properties.slice(0, 12).map((p) => (
                <Link key={p.id} className="job" href={specHref(spec?.id ?? null).replace("/account/quote/new?", `/account/quote/new?property=${p.id}&`)} style={{ display: "block", marginBottom: 8 }}>
                  <div className="addr" style={{ fontWeight: 600 }}>{[p.address, p.suburb].filter(Boolean).join(", ") || "Your property"}</div>
                </Link>
              ))}
            </div>
          ) : null}
          <Link className="btn btn-ghost" href="/estimate?mode=customer" style={{ marginTop: ctx.properties.length ? 8 : 0 }}>Somewhere new — type an address</Link>
        </div>
      )}

      <h2>Spec</h2>
      <div className="card" data-testid="spec-tiles">
        {specs.map((s) => (
          <Link key={s.id} href={specHref(s.id)} className="job" data-testid="spec-tile" aria-current={spec?.id === s.id ? "true" : undefined}
            style={{ display: "block", marginBottom: 8, outline: spec?.id === s.id ? "2px solid var(--cyan, #0891b2)" : undefined }}>
            <div className="addr" style={{ fontWeight: 600 }}>{s.name}</div>
            <div className="meta">{specSummary(s)}{s.usedCount ? ` · used ${s.usedCount}×` : ""}</div>
          </Link>
        ))}
        <Link href={specHref(null)} className="job" data-testid="spec-blank" aria-current={!spec ? "true" : undefined}
          style={{ display: "block", outline: !spec ? "2px solid var(--cyan, #0891b2)" : undefined }}>
          <div className="addr" style={{ fontWeight: 600 }}>Start blank</div>
          <div className="meta">Build the sheet yourself</div>
        </Link>
        {specs.length === 0 && <p className="sub" style={{ marginTop: 8 }}>Save a spec from any finished quote and it appears here.</p>}
      </div>

      {file?.tree && state && (
        <div className="card raised" data-testid="estimated-from-file">
          <div className="sub" style={{ letterSpacing: ".04em", textTransform: "uppercase", fontSize: 12 }}>Estimated from the file</div>
          {range ? (
            <>
              <div className="big" data-testid="file-range">{moneyFmt(range.lo)} – {moneyFmt(range.hi)}</div>
              <div className="sub">inc. GST · ±{range.bandPct}%</div>
              <p className="sub" style={{ marginTop: 8 }}>
                Because this property is measured and the spec is saved, the range is ready before you open the sheet.
              </p>
            </>
          ) : (
            <p className="sub" style={{ marginTop: 4 }}>This spec paints nothing that is on the file — open the sheet and tick what you need.</p>
          )}
          <div style={{ marginTop: 12 }}>
            <OpenSheet state={state} />
          </div>
        </div>
      )}
      {file && !file.tree && (
        <div className="card">
          <Link className="btn btn-cyan" href={`/estimate?mode=customer&property=${file.id}&rebook=1${spec ? `&spec=${spec.id}` : ""}`}>Walk the rooms</Link>
        </div>
      )}
    </div>
  );
}
