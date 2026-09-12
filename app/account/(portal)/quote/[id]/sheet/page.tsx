import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCustomerScope, type EstimateRow } from "@/lib/wizard/customer-scope";
import { sheetRows } from "@/lib/wizard/spec-sheet";
import { latestColours } from "@/lib/portal/colours-on-file";
import { parseMeasuredTree } from "@/lib/wizard/measured-tree";
import { fileFacts } from "@/lib/wizard/trade-quote";
import SpecSheet from "./SpecSheet";

export const dynamic = "force-dynamic";

/**
 * C15 · walk A · screen A3 — THE SPEC SHEET.
 *
 * The same tree as a grid: areas down, surfaces across, coat cells cycling
 * 1c → 2c → not painted, each tap calling the SAME reprice action the room
 * card calls. Colours default from the property's register. The range in the
 * header is the customer payload's — the one range every surface shows.
 * Trade never sees fix-online (⚑11): the only way off this screen is
 * "Send for confirmation", which is the room card's `accept_intent`.
 */
export default async function TradeSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");
  if (!ctx.accounts.some((a) => a.account_type === "trade")) redirect("/account");
  const svc = createServiceClient();
  if (!svc) return <div className="card"><p className="sub">The sheet is unavailable right now — try again shortly.</p></div>;

  const { data: estimate } = await svc.from("estimates")
    .select("id, title, status, source, created_by, requires_site_check, builder_state, account_id, property_id")
    .eq("id", id).maybeSingle();
  if (!estimate || !ctx.accounts.some((a) => a.id === estimate.account_id)) notFound();

  const bundle = await loadCustomerScope(svc, estimate as EstimateRow);
  if (bundle.kind !== "rooms") {
    return (
      <div>
        <Link href="/account" className="sub" style={{ display: "inline-block", marginBottom: 8 }}>‹ Home</Link>
        <div className="card"><p className="sub">{bundle.kind === "holding" ? bundle.line : "This quote is an outside job — it goes to a brief and a visit, not a sheet."}</p></div>
      </div>
    );
  }

  const blocks = ((estimate.builder_state as { blocks?: unknown[] } | null)?.blocks ?? []) as Array<Record<string, unknown>>;
  const rows = sheetRows(blocks);
  const propertyId = (estimate.property_id as string | null) ?? null;
  const property = propertyId ? ctx.properties.find((p) => p.id === propertyId) ?? null : null;
  const [colours, propRow, openReq] = await Promise.all([
    propertyId ? latestColours(svc, propertyId) : Promise.resolve([]),
    propertyId ? svc.from("properties").select("access_notes, measured_tree, measured_at").eq("id", propertyId).maybeSingle() : Promise.resolve({ data: null }),
    // Sent = a confirmation request is open or fixed on it: the sheet is then read-only.
    svc.from("confirmation_requests").select("id").eq("estimate_id", estimate.id).in("status", ["requested", "question_asked", "fixed"]).limit(1),
  ]);
  const tree = propRow.data ? parseMeasuredTree(propRow.data.measured_tree, propRow.data.measured_at as string | null) : null;
  const facts = fileFacts(tree);
  const sent = estimate.status !== "draft" || ((openReq.data ?? []).length > 0);
  const specName = ((estimate.builder_state as { wizard?: { state?: { specName?: string } } } | null)?.wizard?.state?.specName) ?? null;

  return (
    <div data-testid="spec-sheet-page">
      <Link href={property ? `/account/quote/new?property=${property.id}` : "/account/quote/new"} className="sub" style={{ display: "inline-block", marginBottom: 8 }}>‹ New quote</Link>
      <div className="greet">{[property?.address, property?.suburb].filter(Boolean).join(", ") || estimate.title || "Your quote"}</div>
      <h1>{specName ?? "The sheet"}</h1>
      <p className="sub">Every area, every surface, every coat on one screen. Tap a cell to change it — the range moves as you go.</p>

      <SpecSheet
        estimateId={estimate.id as string}
        initialRows={rows}
        initialRooms={bundle.initialRooms}
        initialRange={{ lo: bundle.initial.rangeLoCents, hi: bundle.initial.rangeHiCents, bandPct: bundle.initial.bandPct }}
        initialLadder={bundle.initialLadder}
        sent={sent}
        colours={colours}
        estimatorName={bundle.estimator.name}
        holdDays={bundle.holdDays}
        tenantHref={`/account/quote/${estimate.id}/tenant`}
        onFile={{
          measured: facts.measuredLabel ? `Measured ${facts.measuredLabel}, on site` : null,
          access: (propRow.data?.access_notes as string | null)?.trim() || null,
        }}
      />
    </div>
  );
}
