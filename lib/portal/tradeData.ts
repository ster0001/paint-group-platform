/**
 * Trade portal v2 · Session 3 — data for the property-spine screens.
 *
 * Server-only (service client over customer-safe columns, the 3a pattern:
 * builder_state and margins never leave the server). Every function takes an
 * explicit `view: "trade"` — the standing never-role-inferred rule — and
 * batches its reads (.in() on the id chain, no per-property round trips: the
 * 40-property acceptance target is < 1.5 s).
 */
import { createServiceClient } from "@/lib/supabase/service";
import { getPortalJobs, getPortalMoney, getPortalVariations, melbourneTodayYmd, type PortalContext } from "./data";
import { moneyFmt } from "./money";
import {
  buildTradePortfolio,
  type TPColourSwatch,
  type TPReference,
  type TPSurfaceCount,
  type TPWorkOrder,
  type TradePortfolio,
} from "./tradePortfolio";

type WoRow = { id: string; estimate_id: string; wo_ref: string | null; stage: string; start_date: string | null; end_date: string | null };

export async function getTradePortfolio(ctx: PortalContext, view: "trade"): Promise<TradePortfolio | null> {
  if (view !== "trade") return null;
  const svc = createServiceClient();
  if (!svc) return null;
  const accountIds = ctx.accounts.map((a) => a.id);
  const propertyIds = ctx.properties.map((p) => p.id);

  const [{ estimates }, money, variations, pendingRes, refsRes, coloursRes] = await Promise.all([
    getPortalJobs(accountIds),
    getPortalMoney(accountIds),
    getPortalVariations(accountIds),
    svc.from("external_approvals").select("estimate_id, approver_name")
      .in("account_id", accountIds).is("decided_at", null),
    propertyIds.length
      ? svc.from("property_references").select("property_id, label, value, sort").in("property_id", propertyIds)
      : Promise.resolve({ data: [] }),
    propertyIds.length
      ? svc.from("colour_records").select("property_id, surface_type, swatch_hex, status").in("property_id", propertyIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Work orders with ids + refs (the home.ts shape omits both), one query.
  const estIds = estimates.map((e) => e.id);
  const wosRes = estIds.length
    ? await svc.from("work_orders")
        .select("id, estimate_id, wo_ref, stage, start_date, end_date")
        .in("estimate_id", estIds)
    : { data: [] };
  const workOrders = (wosRes.data ?? []) as WoRow[];

  // Surface tick ratio for the active jobs only — the progress bars.
  const activeIds = workOrders
    .filter((w) => ["in_progress", "qa", "completion_prep"].includes(w.stage))
    .map((w) => w.id);
  const surfaceCounts: TPSurfaceCount[] = [];
  if (activeIds.length) {
    const { data } = await svc.from("wo_surfaces").select("work_order_id, state").in("work_order_id", activeIds);
    const byWo = new Map<string, { done: number; total: number }>();
    for (const r of (data ?? []) as Array<{ work_order_id: string; state: string }>) {
      const c = byWo.get(r.work_order_id) ?? { done: 0, total: 0 };
      c.total += 1;
      if (r.state === "done") c.done += 1;
      byWo.set(r.work_order_id, c);
    }
    for (const [work_order_id, c] of byWo) surfaceCounts.push({ work_order_id, ...c });
  }

  return buildTradePortfolio({
    properties: ctx.properties,
    references: (refsRes.data ?? []) as TPReference[],
    colours: (coloursRes.data ?? []) as TPColourSwatch[],
    estimates: estimates.map((e) => ({
      id: e.id, title: e.title, status: e.status, total_cents: e.total_cents,
      share_token: e.share_token, property_id: e.property_id ?? null,
      sent_at: e.sent_at, created_at: e.created_at,
    })),
    workOrders: workOrders as TPWorkOrder[],
    surfaceCounts,
    invoices: money.invoices,
    payments: money.payments,
    variations,
    pendingApprovals: (pendingRes.data ?? []) as Array<{ estimate_id: string; approver_name: string }>,
    todayYmd: melbourneTodayYmd(),
  });
}

// ---- timeline: the extra events trade users see (§5.3) ----------------------

export type TradeTimelineEvent = {
  key: string; at: string; title: string; body: string;
  chip: { cls: "cyan" | "amber" | "emerald" | "clay" | "mut"; label: string } | null;
  photoIds: string[]; cta: { label: string; href: string } | null; amountCents: number | null;
};

/**
 * "Colours confirmed & paint ordered" (the pre-start colours YES),
 * "Painter confirmed" (the accepted booking offer), and the external-
 * approval trail (sent / opened / decided — rows arrive with session 5's
 * send flow; the rendering is live already). First names only, ever.
 */
export async function getTradeTimelineEvents(
  workOrderId: string,
  estimateId: string,
  viewerRole?: string,
): Promise<TradeTimelineEvent[]> {
  const svc = createServiceClient();
  if (!svc) return [];
  const isOrgAdmin = viewerRole === "admin" || viewerRole === "owner";
  const [coloursRes, offerRes, approvalsRes, overLimitRes] = await Promise.all([
    svc.from("wo_checklist_items").select("done_at")
      .eq("work_order_id", workOrderId).eq("item_key", "colours").eq("answer", "yes")
      .not("done_at", "is", null).maybeSingle(),
    svc.from("booking_offers").select("responded_at, contractors(profiles(name))")
      .eq("work_order_id", workOrderId).eq("state", "accepted")
      .order("responded_at", { ascending: false }).limit(1).maybeSingle(),
    svc.from("external_approvals")
      .select("id, approver_name, signer_name, sent_at, viewed_at, decided_at, decision")
      .eq("estimate_id", estimateId),
    // ⚑2's record — surfaced to the org's admins only.
    isOrgAdmin
      ? svc.from("wo_events").select("id, created_at, meta")
          .eq("work_order_id", workOrderId).eq("type", "approved_over_limit")
      : Promise.resolve({ data: [] }),
  ]);

  const out: TradeTimelineEvent[] = [];
  const coloursAt = (coloursRes.data as { done_at: string | null } | null)?.done_at;
  if (coloursAt) {
    out.push({
      key: "trade:colours", at: coloursAt,
      title: "Colours confirmed & paint ordered",
      body: "The colour schedule is locked in. Every colour lives on this property's Colours tab.",
      chip: null, photoIds: [], cta: null, amountCents: null,
    });
  }
  const offer = offerRes.data as
    | { responded_at: string | null; contractors?: { profiles?: { name?: string | null } | { name?: string | null }[] | null } | null }
    | null;
  if (offer?.responded_at) {
    const prof = offer.contractors?.profiles;
    const name = (Array.isArray(prof) ? prof[0]?.name : prof?.name)?.trim().split(/\s+/)[0] ?? null;
    out.push({
      key: "trade:painter", at: offer.responded_at,
      title: "Painter confirmed",
      body: name ? `${name} accepted the booking.` : "Your painter accepted the booking.",
      chip: null, photoIds: [], cta: null, amountCents: null,
    });
  }
  for (const a of (approvalsRes.data ?? []) as Array<{
    id: string; approver_name: string; signer_name: string | null;
    sent_at: string | null; viewed_at: string | null; decided_at: string | null; decision: string | null;
  }>) {
    const first = a.approver_name.trim().split(/\s+/)[0];
    if (a.sent_at) out.push({
      key: `trade:approval-sent:${a.id}`, at: a.sent_at,
      title: `Sent to ${first} to approve`,
      body: "They received a direct link to review and decide.",
      chip: null, photoIds: [], cta: null, amountCents: null,
    });
    if (a.viewed_at) out.push({
      key: `trade:approval-viewed:${a.id}`, at: a.viewed_at,
      title: `Opened by ${first}`, body: "The estimate has been viewed.",
      chip: null, photoIds: [], cta: null, amountCents: null,
    });
    if (a.decided_at && a.decision) out.push({
      key: `trade:approval-decided:${a.id}`, at: a.decided_at,
      title: a.decision === "approved" ? `Approved by ${a.signer_name?.trim() || first}` : `Declined by ${first}`,
      body: a.decision === "approved" ? "Signed and accepted through their link." : "Declined through their link.",
      chip: a.decision === "approved" ? { cls: "emerald", label: "Approved" } : { cls: "clay", label: "Declined" },
      photoIds: [], cta: null, amountCents: null,
    });
  }
  for (const ev of (overLimitRes.data ?? []) as Array<{ id: string; created_at: string; meta: { limitCents?: number; totalCents?: number; by?: string } }>) {
    const m = ev.meta ?? {};
    out.push({
      key: `trade:over-limit:${ev.id}`, at: ev.created_at,
      title: "Approved over limit",
      body: `${m.by ?? "A team member"} approved ${typeof m.totalCents === "number" ? moneyFmt(m.totalCents) : "this estimate"} — above their ${typeof m.limitCents === "number" ? moneyFmt(m.limitCents) : ""} approval limit.`.replace(/\s+/g, " "),
      chip: { cls: "amber", label: "Over limit" },
      photoIds: [], cta: null, amountCents: null,
    });
  }
  return out;
}

// ---- property detail --------------------------------------------------------

export type PropertyColourCard = {
  id: string;
  areaLabel: string;
  surfaceType: string;
  brand: string;
  product: string;
  colourName: string;
  colourCode: string;
  sheen: string;
  coats: number;
  swatchHex: string | null;
  status: "planned" | "applied" | "superseded";
  appliedFrom: string | null;
  appliedTo: string | null;
  lossy: boolean;
};

export type TradePropertyDetail = {
  property: { id: string; address: string };
  references: Array<{ label: string; value: string }>;
  currentJob: {
    workOrderId: string;
    woRef: string | null;
    title: string;
    stage: string;
    startDate: string | null;
    endDate: string | null;
    painterFirstName: string | null;
    surfacesDone: number;
    surfacesTotal: number;
  } | null;
  /** WO has unnamed colours / an unanswered or No colours question. */
  coloursTbc: boolean;
  colourCards: PropertyColourCard[];
  jobHistory: Array<{ woRef: string | null; title: string; closedLabel: string | null; reportToken: string | null; current: boolean }>;
  money: {
    thisJobTotalCents: number | null;
    paidCents: number;
    invoices: Array<{
      id: string; number: string | null; kind: string; status: string;
      totalIncCents: number; token: string | null; issuedOn: string | null; paid: boolean;
    }>;
  };
  documents: Array<{ title: string; meta: string; href: string }>;
  aboutDocs: Array<{ id: string; title: string; meta: string }>;
  companyPhone: string;
};

const STAGE_ORDER = ["offered", "pre_start", "in_progress", "qa", "completion_prep", "walkthrough", "closed"];

export async function getTradeProperty(
  ctx: PortalContext,
  propertyId: string,
  view: "trade",
): Promise<TradePropertyDetail | null> {
  if (view !== "trade") return null;
  const property = ctx.properties.find((p) => p.id === propertyId);
  if (!property) return null; // scope: only the member's own properties resolve
  const svc = createServiceClient();
  if (!svc) return null;

  const [refsRes, coloursRes, estsRes] = await Promise.all([
    svc.from("property_references").select("label, value, sort").eq("property_id", propertyId).order("sort"),
    svc.from("colour_records")
      .select("id, area_label, surface_type, brand, product, colour_name, colour_code, sheen, coats, swatch_hex, status, applied_from, applied_to, colour_attribution_lossy, created_at")
      .eq("property_id", propertyId).order("created_at"),
    svc.from("estimates").select("id, title, status, total_cents, accepted_total_cents:total_cents")
      .eq("property_id", propertyId).in("account_id", ctx.accounts.map((a) => a.id)),
  ]);

  const ests = (estsRes.data ?? []) as Array<{ id: string; title: string | null; status: string; total_cents: number | null }>;
  const estIds = ests.map((e) => e.id);
  const estById = new Map(ests.map((e) => [e.id, e]));

  const [wosRes, invRes] = await Promise.all([
    estIds.length
      ? svc.from("work_orders")
          .select("id, estimate_id, wo_ref, stage, start_date, end_date, contractor_id, colours, wo_snapshot")
          .in("estimate_id", estIds).not("issued_at", "is", null)
      : Promise.resolve({ data: [] }),
    estIds.length
      ? svc.from("invoices")
          .select("id, estimate_id, kind, status, number, token, issued_on, total_inc_cents, payments(amount_cents, status)")
          .in("estimate_id", estIds)
      : Promise.resolve({ data: [] }),
  ]);

  type PropWo = {
    id: string; estimate_id: string; wo_ref: string | null; stage: string;
    start_date: string | null; end_date: string | null; contractor_id: string | null;
    colours: Record<string, { name?: string; status?: string }> | null;
    wo_snapshot: { materials?: Array<{ colourName?: string }> } | null;
  };
  const wos = (wosRes.data ?? []) as PropWo[];

  // The current job: the furthest-along OPEN work order.
  const open = wos.filter((w) => w.stage !== "closed")
    .sort((a, b) => STAGE_ORDER.indexOf(b.stage) - STAGE_ORDER.indexOf(a.stage));
  const current = open[0] ?? null;

  let painterFirstName: string | null = null;
  let surfacesDone = 0;
  let surfacesTotal = 0;
  let coloursTbc = false;
  if (current) {
    const [surfRes, contractorRes, coloursItemRes] = await Promise.all([
      svc.from("wo_surfaces").select("state").eq("work_order_id", current.id),
      current.contractor_id
        ? svc.from("contractors").select("profiles(name)").eq("id", current.contractor_id).maybeSingle()
        : Promise.resolve({ data: null }),
      svc.from("wo_checklist_items").select("answer")
        .eq("work_order_id", current.id).eq("item_key", "colours").maybeSingle(),
    ]);
    const states = (surfRes.data ?? []) as Array<{ state: string }>;
    surfacesTotal = states.length;
    surfacesDone = states.filter((s) => s.state === "done").length;
    const profile = (contractorRes.data as { profiles?: { name?: string | null } | { name?: string | null }[] } | null)?.profiles;
    const name = (Array.isArray(profile) ? profile[0]?.name : profile?.name) ?? null;
    painterFirstName = name ? name.split(/\s+/)[0] : null;
    // TBC: the question answered No, unanswered, or any material still unnamed.
    const answer = (coloursItemRes.data as { answer: string | null } | null)?.answer ?? null;
    const liveNames = Object.values(current.colours ?? {}).map((c) => c?.name?.trim() ?? "");
    const materials = current.wo_snapshot?.materials ?? [];
    const unnamed = materials.some((m, i) => !(m.colourName?.trim() || liveNames[i]));
    const anyLiveNamed = liveNames.some(Boolean);
    coloursTbc = answer === "no" || (answer !== "yes" && (materials.length ? unnamed : !anyLiveNamed));
  }

  // Money: numbers from the invoicing rows, nothing recomputed here beyond sums.
  type InvRow = {
    id: string; estimate_id: string; kind: string; status: string; number: string | null;
    token: string | null; issued_on: string | null; total_inc_cents: number;
    payments: Array<{ amount_cents: number; status: string }> | null;
  };
  const VISIBLE = new Set(["issued", "sent", "viewed", "partially_paid", "paid"]);
  const invoices = ((invRes.data ?? []) as InvRow[]).filter((i) => VISIBLE.has(i.status));
  const paidCents = invoices.flatMap((i) => i.payments ?? [])
    .filter((p) => p.status === "succeeded").reduce((a, p) => a + p.amount_cents, 0);
  const currentEstimate = current ? estById.get(current.estimate_id) : null;

  // Documents: signed reports + warranties for closed jobs, approved estimates.
  const woIds = wos.map((w) => w.id);
  const [signRes, warrRes, docsRes] = await Promise.all([
    woIds.length
      ? svc.from("wo_signoff").select("work_order_id, signed_at, customer_token").in("work_order_id", woIds)
      : Promise.resolve({ data: [] }),
    woIds.length
      ? svc.from("warranties").select("work_order_id, starts_on, ends_on, years").in("work_order_id", woIds)
      : Promise.resolve({ data: [] }),
    svc.from("company_documents").select("id, title, kind, expires_on").eq("active", true).order("created_at"),
  ]);
  const signoffs = (signRes.data ?? []) as Array<{ work_order_id: string; signed_at: string | null; customer_token: string | null }>;
  const warranties = (warrRes.data ?? []) as Array<{ work_order_id: string; starts_on: string; ends_on: string; years: number }>;

  const documents: TradePropertyDetail["documents"] = [];
  for (const w of wos) {
    const sign = signoffs.find((s) => s.work_order_id === w.id && s.signed_at && s.customer_token);
    if (sign) documents.push({
      title: `Completion report — ${w.wo_ref ?? "job"}`,
      meta: `Signed ${sign.signed_at!.slice(0, 10)} · before/after photos`,
      href: `/s/${sign.customer_token}`,
    });
    const warr = warranties.find((x) => x.work_order_id === w.id);
    if (warr) documents.push({
      title: `Warranty certificate — ${w.wo_ref ?? "job"}`,
      meta: `${warr.years}-year workmanship · to ${warr.ends_on}`,
      href: `/account/warranty/${w.id}`,
    });
  }
  const jobHistory = wos
    .sort((a, b) => STAGE_ORDER.indexOf(b.stage) - STAGE_ORDER.indexOf(a.stage))
    .map((w) => {
      const sign = signoffs.find((s) => s.work_order_id === w.id && s.signed_at);
      return {
        woRef: w.wo_ref,
        title: estById.get(w.estimate_id)?.title?.trim() || "Painting works",
        closedLabel: w.stage === "closed" ? (sign?.signed_at?.slice(0, 10) ?? "complete") : null,
        reportToken: sign?.customer_token ?? null,
        current: current?.id === w.id,
      };
    });

  const address = [property.address, property.suburb].filter(Boolean).join(", ") || "Your property";
  return {
    property: { id: property.id, address },
    references: ((refsRes.data ?? []) as Array<{ label: string; value: string }>).map((r) => ({ label: r.label, value: r.value })),
    currentJob: current ? {
      workOrderId: current.id,
      woRef: current.wo_ref,
      title: currentEstimate?.title?.trim() || "Painting works",
      stage: current.stage,
      startDate: current.start_date,
      endDate: current.end_date,
      painterFirstName,
      surfacesDone,
      surfacesTotal,
    } : null,
    coloursTbc,
    colourCards: ((coloursRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      areaLabel: r.area_label as string,
      surfaceType: r.surface_type as string,
      brand: r.brand as string,
      product: r.product as string,
      colourName: r.colour_name as string,
      colourCode: r.colour_code as string,
      sheen: r.sheen as string,
      coats: r.coats as number,
      swatchHex: (r.swatch_hex as string | null) ?? null,
      status: r.status as PropertyColourCard["status"],
      appliedFrom: (r.applied_from as string | null) ?? null,
      appliedTo: (r.applied_to as string | null) ?? null,
      lossy: Boolean(r.colour_attribution_lossy),
    })),
    jobHistory,
    money: {
      thisJobTotalCents: currentEstimate?.total_cents ?? null,
      paidCents,
      invoices: invoices.map((i) => ({
        id: i.id, number: i.number, kind: i.kind, status: i.status,
        totalIncCents: i.total_inc_cents, token: i.token, issuedOn: i.issued_on,
        paid: i.status === "paid",
      })),
    },
    documents,
    aboutDocs: ((docsRes.data ?? []) as Array<{ id: string; title: string; kind: string; expires_on: string | null }>)
      .map((d) => ({ id: d.id, title: d.title, meta: d.expires_on ? `Valid to ${d.expires_on}` : d.kind })),
    companyPhone: ctx.companyPhone,
  };
}
