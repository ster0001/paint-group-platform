import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { PortalEstimate, PortalWorkOrder } from "./home";

/**
 * 3a-2 · The customer portal's data layer. SERVER ONLY.
 *
 * Membership, accounts and properties are read through the CALLER'S session —
 * RLS is the authority on what they own. Estimates and work orders are then
 * read through the service client, scoped to exactly those account ids (the
 * explicit-ownership pattern from lib/supabase/service.ts), selecting ONLY
 * customer-safe columns. builder_state, margins, contractor pay and internal
 * workings never enter a portal payload — the standing role-view rule.
 */

export type PortalAccount = {
  id: string;
  account_type: "residential" | "trade";
  email: string;
  name: string | null;
  phone: string | null;
};

export type PortalProperty = {
  id: string;
  account_id: string;
  address: string | null;
  suburb: string | null;
  postcode: string | null;
};

export type PortalContext = {
  userId: string;
  email: string;
  firstName: string | null;
  accounts: PortalAccount[];
  properties: PortalProperty[];
  companyName: string;
  companyPhone: string;
  logoUrl: string;
};

/** The public-safe company contact block (name, phone, logo). Read through
 * the SERVICE client: `settings` is staff-RLS'd, and customers and the
 * anonymous login page still need the phone number — §7: it never hides.
 * Only these three display fields ever leave this function. */
export async function getCompanyContact(): Promise<{ name: string; phone: string; logoUrl: string }> {
  const svc = createServiceClient();
  if (!svc) return { name: "Paint Group", phone: "", logoUrl: "" };
  const { data } = await svc.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const v = (data?.value ?? {}) as { name?: string; phone?: string; logoUrl?: string };
  return { name: v.name || "Paint Group", phone: v.phone || "", logoUrl: v.logoUrl || "" };
}

export async function getPortalContext(): Promise<PortalContext | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) return null;

  // ONE round trip for the whole owned chain (volume gate finding: the
  // membership → accounts → properties waterfall was three). RLS applies to
  // every embedded level — the caller still only sees what they own.
  const [{ data: memberships }, { data: profile }, company] = await Promise.all([
    supabase
      .from("account_users")
      .select("account_id, role, accounts(id, account_type, email, name, phone, properties(id, account_id, address, suburb, postcode))"),
    supabase.from("profiles").select("name").eq("id", user.id).maybeSingle(),
    getCompanyContact(),
  ]);

  const accounts: PortalAccount[] = [];
  const properties: PortalProperty[] = [];
  for (const m of (memberships ?? []) as unknown as Array<{ accounts: (PortalAccount & { properties?: PortalProperty[] }) | null }>) {
    if (!m.accounts) continue;
    const { properties: props, ...account } = m.accounts;
    accounts.push(account);
    for (const p of props ?? []) properties.push(p);
  }

  const name = accounts[0]?.name || (profile?.name as string | null) || null;
  return {
    userId: user.id,
    email: user.email,
    firstName: name ? name.trim().split(/\s+/)[0] : null,
    accounts,
    properties,
    companyName: company.name,
    companyPhone: company.phone,
    logoUrl: company.logoUrl,
  };
}

export type PortalJobs = {
  estimates: PortalEstimate[];
  workOrders: PortalWorkOrder[];
};

/** Customer-safe job data for the accounts the CALLER was proven to own.
 * accountIds must come from getPortalContext() — never from the client. */
export async function getPortalJobs(accountIds: string[]): Promise<PortalJobs> {
  if (!accountIds.length) return { estimates: [], workOrders: [] };
  const svc = createServiceClient();
  if (!svc) return { estimates: [], workOrders: [] };

  // One round trip: the work order rides its estimate (volume gate finding).
  const { data: estimates } = await svc
    .from("estimates")
    .select("id, title, status, source, total_cents, share_token, sent_at, created_at, property_id, work_orders(estimate_id, stage, start_date, end_date)")
    .in("account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (estimates ?? []) as Array<PortalEstimate & { work_orders?: PortalWorkOrder | PortalWorkOrder[] | null }>;
  const workOrders: PortalWorkOrder[] = [];
  for (const row of rows) {
    const wo = row.work_orders;
    if (Array.isArray(wo)) workOrders.push(...wo);
    else if (wo) workOrders.push(wo);
    delete row.work_orders;
  }
  return { estimates: rows as PortalEstimate[], workOrders };
}

import type { MoneyEstimate, MoneyInvoice, MoneyPayment } from "./money";

export type PortalMoney = {
  estimates: MoneyEstimate[];
  invoices: MoneyInvoice[];
  payments: MoneyPayment[];
};

/** Customer-safe money rows for proven account ids: issued-side invoice
 * fields and succeeded-payment receipt fields only. Surcharge splits,
 * Stripe internals and staff workings never leave the server. */
export async function getPortalMoney(accountIds: string[]): Promise<PortalMoney> {
  if (!accountIds.length) return { estimates: [], invoices: [], payments: [] };
  const svc = createServiceClient();
  if (!svc) return { estimates: [], invoices: [], payments: [] };

  const { data: estimates } = await svc
    .from("estimates")
    .select("id, title, status, accepted_total_cents")
    .in("account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(50);

  const estIds = (estimates ?? []).map((e) => e.id as string);
  if (!estIds.length) return { estimates: [], invoices: [], payments: [] };

  const { data: invoices } = await svc
    .from("invoices")
    .select("id, estimate_id, kind, status, number, token, issued_on, due_on, total_inc_cents, gst_cents")
    .in("estimate_id", estIds);

  const invIds = (invoices ?? []).map((i) => i.id as string);
  let payments: MoneyPayment[] = [];
  if (invIds.length) {
    const { data: pays } = await svc
      .from("payments")
      .select("id, invoice_id, amount_cents, status, paid_on, receipt_number")
      .in("invoice_id", invIds);
    payments = (pays ?? []) as MoneyPayment[];
  }
  return {
    estimates: (estimates ?? []) as MoneyEstimate[],
    invoices: (invoices ?? []) as MoneyInvoice[],
    payments,
  };
}

import type { TimelineInput } from "./timeline";
import { signPortalPhotos, type PortalPhoto } from "./photos";

export type PortalProject = {
  estimateId: string;
  title: string;
  stage: string;
  startDate: string | null;
  endDate: string | null;
  painterFirstName: string | null;
  /** The signed completion report's /s token — null until signed off. */
  reportToken: string | null;
  timeline: Omit<TimelineInput, "todayYmd">;
  /** Unsigned rows — the page signs ONLY the ids it will render (the volume
   * gate's finding: signing every fetched photo doubled the timeline p95). */
  photoRows: Array<{ id: string; kind: string; area: string; caption: string; storage_path: string }>;
};

/** Sign exactly the photos a page will render. */
export async function signPhotosByIds(
  rows: PortalProject["photoRows"],
  ids: readonly string[],
): Promise<Map<string, PortalPhoto>> {
  const svc = createServiceClient();
  if (!svc) return new Map();
  const wanted = new Set(ids);
  return signPortalPhotos(svc, rows.filter((r) => wanted.has(r.id)));
}

const PROJECT_STAGE_ORDER = ["walkthrough", "in_progress", "qa", "completion_prep", "pre_start", "offered", "closed"];

/** The account's current project — the WO the customer would call "my job".
 * All reads via the service client scoped to PROVEN account ids; only
 * customer-safe columns are selected (no pay, no margins, no QA workings —
 * a FAILED check is never fetched, so it cannot render). */
export async function getPortalProject(accountIds: string[]): Promise<PortalProject | null> {
  if (!accountIds.length) return null;
  const svc = createServiceClient();
  if (!svc) return null;

  const { data: ests } = await svc
    .from("estimates").select("id, title").in("account_id", accountIds)
    .order("created_at", { ascending: false }).limit(100);
  const estById = new Map((ests ?? []).map((e) => [e.id as string, e]));
  if (!estById.size) return null;

  const { data: wos } = await svc
    .from("work_orders")
    .select("id, estimate_id, stage, start_date, end_date, contractor_id, issued_at")
    .in("estimate_id", [...estById.keys()])
    .not("issued_at", "is", null);
  const sorted = (wos ?? []).sort(
    (a, b) => PROJECT_STAGE_ORDER.indexOf(a.stage as string) - PROJECT_STAGE_ORDER.indexOf(b.stage as string),
  );
  const wo = sorted[0];
  if (!wo) return null;
  return projectForWo(svc, wo, (estById.get(wo.estimate_id as string)?.title as string | null) ?? null);
}

/**
 * The same project payload for ONE work order, ownership already proven by
 * the caller. Trade portal v2 session 4: the property-scoped timeline route
 * verifies estimate.account_id + property_id, then reads through here — one
 * fetch for both portals, never a fork.
 */
export async function getPortalProjectByWorkOrder(
  accountIds: string[],
  workOrderId: string,
): Promise<{ project: PortalProject; propertyId: string | null } | null> {
  if (!accountIds.length) return null;
  const svc = createServiceClient();
  if (!svc) return null;
  const { data: wo } = await svc
    .from("work_orders")
    .select("id, estimate_id, stage, start_date, end_date, contractor_id, issued_at")
    .eq("id", workOrderId).not("issued_at", "is", null).maybeSingle();
  if (!wo) return null;
  const { data: est } = await svc
    .from("estimates").select("id, title, account_id, property_id").eq("id", wo.estimate_id).maybeSingle();
  if (!est || !accountIds.includes(est.account_id as string)) return null;
  const project = await projectForWo(svc, wo, (est.title as string | null) ?? null);
  return { project, propertyId: (est.property_id as string | null) ?? null };
}

async function projectForWo(
  svc: NonNullable<ReturnType<typeof createServiceClient>>,
  wo: { id: string; estimate_id: string; stage: string; start_date: string | null; end_date: string | null; contractor_id: string | null },
  title: string | null,
): Promise<PortalProject> {
  const [surfaces, updates, photos, variations, qa, walkthrough, signoff, events, deposit, painter] =
    await Promise.all([
      svc.from("wo_surfaces").select("heading, label, state, sort").eq("work_order_id", wo.id),
      svc.from("wo_updates").select("for_date, final_text, draft_text, sent_at")
        .eq("work_order_id", wo.id).eq("status", "sent").not("sent_at", "is", null),
      svc.from("wo_photos").select("id, kind, area, caption, storage_path, created_at")
        .eq("work_order_id", wo.id).in("kind", ["before", "progress", "completion"])
        .order("created_at", { ascending: false }).limit(40),
      svc.from("wo_variations")
        .select("id, status, category, comment, price_cents, customer_token, customer_responded_at, created_at")
        .eq("work_order_id", wo.id),
      svc.from("wo_qa_checks").select("checked_at").eq("work_order_id", wo.id)
        .eq("result", "pass").order("checked_at", { ascending: false }).limit(1),
      svc.from("wo_walkthroughs").select("scheduled_date").eq("work_order_id", wo.id)
        .eq("kind", "final").eq("status", "booked").order("scheduled_date").limit(1),
      svc.from("wo_signoff").select("signed_at, customer_token").eq("work_order_id", wo.id).maybeSingle(),
      svc.from("wo_events").select("type, to_stage, created_at").eq("work_order_id", wo.id)
        .eq("type", "stage_changed").in("to_stage", ["in_progress", "walkthrough"])
        .order("created_at", { ascending: true }),
      svc.from("invoices").select("id, kind, status, total_inc_cents, payments(paid_on, status, amount_cents)")
        .eq("estimate_id", wo.estimate_id).eq("kind", "deposit").limit(1),
      wo.contractor_id
        ? svc.from("contractors").select("profile_id, profiles(name)").eq("id", wo.contractor_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const photoRows = (photos.data ?? []) as Array<{
    id: string; kind: string; area: string; caption: string; storage_path: string; created_at: string;
  }>;

  const underway = (events.data ?? []).find((e) => e.to_stage === "in_progress");
  const ready = (events.data ?? []).find((e) => e.to_stage === "walkthrough");

  const dep = (deposit.data ?? [])[0] as
    | { total_inc_cents: number; payments?: Array<{ paid_on: string | null; status: string; amount_cents: number }> }
    | undefined;
  const depPaid = dep?.payments?.find((p) => p.status === "succeeded" && p.paid_on);

  const painterRow = painter.data as { profiles?: { name?: string | null } | null } | null;
  const painterName = painterRow?.profiles?.name?.trim().split(/\s+/)[0] ?? null;

  return {
    estimateId: wo.estimate_id as string,
    title: title?.trim() || "Your project",
    stage: wo.stage as string,
    startDate: (wo.start_date as string | null) ?? null,
    endDate: (wo.end_date as string | null) ?? null,
    painterFirstName: painterName,
    reportToken: (() => {
      const so = signoff.data as { signed_at: string | null; customer_token: string | null } | null;
      return so?.signed_at ? so.customer_token : null;
    })(),
    timeline: {
      surfaces: (surfaces.data ?? []) as TimelineInput["surfaces"],
      updates: ((updates.data ?? []) as Array<{ for_date: string; final_text: string | null; draft_text: string; sent_at: string }>)
        .map((u) => ({ for_date: u.for_date, text: u.final_text?.trim() || u.draft_text, sent_at: u.sent_at })),
      photos: photoRows
        .map((p) => ({ id: p.id, kind: p.kind, area: p.area, caption: p.caption, created_at: p.created_at })),
      variations: (variations.data ?? []) as TimelineInput["variations"],
      underwayAt: (underway?.created_at as string | undefined) ?? null,
      readyAt: (ready?.created_at as string | undefined) ?? null,
      qaPassedAt: ((qa.data ?? [])[0]?.checked_at as string | undefined) ?? null,
      walkthroughFor: ((walkthrough.data ?? [])[0]?.scheduled_date as string | undefined) ?? null,
      signedAt: ((signoff.data as { signed_at: string | null } | null)?.signed_at ?? null),
      depositPaidOn: depPaid?.paid_on ?? null,
      depositCents: depPaid ? dep!.total_inc_cents : null,
    },
    photoRows: photoRows.map(({ id, kind, area, caption, storage_path }) => ({ id, kind, area, caption, storage_path })),
  };
}

import type { RegisterLiveColours, RegisterMaterial, RegisterSnapshotArea } from "./colours";

export type AftercareJob = {
  estimateId: string;
  workOrderId: string;
  title: string;
  stage: string;
  areas: RegisterSnapshotArea[];
  materials: RegisterMaterial[];
  liveColours: RegisterLiveColours;
  /** The pre-start "Colour schedule finalised" tick — the person's yes that
   * IS colour confirmation on the WO loop (the per-product status is legacy). */
  coloursFinalised: boolean;
  warranty: { startsOn: string; endsOn: string; years: number } | null;
  /** The signed report's token link, once signed. */
  reportToken: string | null;
  signedAt: string | null;
};

export type PortalAftercare = {
  jobs: AftercareJob[];
  documents: Array<{ id: string; title: string; kind: string; expiresOn: string | null }>;
  issues: Array<{ id: string; workOrderId: string; note: string; status: string; createdAt: string }>;
  warrantyApproved: boolean;
};

/** Colours, warranty and documents data for proven account ids. The WO
 * snapshot is the contractor-safe document (no customer pricing by
 * construction) — only its areas/materials shapes are lifted out here. */
export async function getPortalAftercare(accountIds: string[]): Promise<PortalAftercare> {
  const empty: PortalAftercare = { jobs: [], documents: [], issues: [], warrantyApproved: false };
  if (!accountIds.length) return empty;
  const svc = createServiceClient();
  if (!svc) return empty;

  const { data: ests } = await svc
    .from("estimates").select("id, title").in("account_id", accountIds)
    .order("created_at", { ascending: false }).limit(100);
  const estById = new Map((ests ?? []).map((e) => [e.id as string, (e.title as string | null)?.trim() || "Your project"]));

  const [wosRes, docsRes, termsRes, issuesRes] = await Promise.all([
    estById.size
      ? svc.from("work_orders")
          .select("id, estimate_id, stage, wo_snapshot, colours")
          .in("estimate_id", [...estById.keys()]).not("issued_at", "is", null)
          .order("issued_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] }),
    svc.from("company_documents").select("id, title, kind, expires_on")
      .eq("active", true).order("created_at", { ascending: false }),
    svc.from("settings").select("value").eq("key", "warranty_terms").maybeSingle(),
    svc.from("warranty_issues").select("id, work_order_id, note, status, created_at")
      .in("account_id", accountIds).order("created_at", { ascending: false }),
  ]);

  const woRows = (wosRes.data ?? []) as Array<{
    id: string; estimate_id: string; stage: string;
    wo_snapshot: { areas?: RegisterSnapshotArea[]; materials?: RegisterMaterial[] } | null;
    colours: RegisterLiveColours;
  }>;

  let warranties: Array<{ work_order_id: string; starts_on: string; ends_on: string; years: number }> = [];
  let signoffs: Array<{ work_order_id: string; signed_at: string | null; customer_token: string | null }> = [];
  const coloursTicked = new Set<string>();
  if (woRows.length) {
    const woIds = woRows.map((w) => w.id);
    const [w, s, ticks] = await Promise.all([
      svc.from("warranties").select("work_order_id, starts_on, ends_on, years").in("work_order_id", woIds),
      svc.from("wo_signoff").select("work_order_id, signed_at, customer_token").in("work_order_id", woIds),
      // The colours box is a person's tick (Tom, 23 Aug) — same rule the PC
      // console reads. Matched by item_key with the label as the fallback
      // for rows created before item_key existed.
      svc.from("wo_checklist_items").select("work_order_id, item_key, label")
        .in("work_order_id", woIds).eq("phase", "pre_start").not("done_at", "is", null),
    ]);
    warranties = (w.data ?? []) as typeof warranties;
    signoffs = (s.data ?? []) as typeof signoffs;
    for (const t of (ticks.data ?? []) as Array<{ work_order_id: string; item_key: string | null; label: string | null }>) {
      if (t.item_key === "colours" || t.label === "Colour schedule finalised") coloursTicked.add(t.work_order_id);
    }
  }

  const jobs: AftercareJob[] = woRows.map((w) => {
    const warranty = warranties.find((x) => x.work_order_id === w.id);
    const signoff = signoffs.find((x) => x.work_order_id === w.id);
    return {
      estimateId: w.estimate_id,
      workOrderId: w.id,
      title: estById.get(w.estimate_id) ?? "Your project",
      stage: w.stage,
      areas: w.wo_snapshot?.areas ?? [],
      materials: w.wo_snapshot?.materials ?? [],
      liveColours: w.colours ?? null,
      coloursFinalised: coloursTicked.has(w.id),
      warranty: warranty
        ? { startsOn: warranty.starts_on, endsOn: warranty.ends_on, years: warranty.years }
        : null,
      reportToken: signoff?.signed_at ? signoff.customer_token : null,
      signedAt: signoff?.signed_at ?? null,
    };
  });

  return {
    jobs,
    documents: ((docsRes.data ?? []) as Array<{ id: string; title: string; kind: string; expires_on: string | null }>)
      .map((d) => ({ id: d.id, title: d.title, kind: d.kind, expiresOn: d.expires_on })),
    issues: ((issuesRes.data ?? []) as Array<{ id: string; work_order_id: string; note: string; status: string; created_at: string }>)
      .map((i) => ({ id: i.id, workOrderId: i.work_order_id, note: i.note, status: i.status, createdAt: i.created_at })),
    warrantyApproved: Boolean((termsRes.data?.value as { approved?: boolean } | null)?.approved),
  };
}

import type { PortfolioVariation } from "./portfolio";

/** Variations awaiting the client across the account's jobs — customer-safe
 * fields only, scoped through the WO→estimate→account chain. */
export async function getPortalVariations(accountIds: string[]): Promise<PortfolioVariation[]> {
  if (!accountIds.length) return [];
  const svc = createServiceClient();
  if (!svc) return [];
  const { data } = await svc
    .from("wo_variations")
    .select("id, status, price_cents, customer_token, customer_responded_at, work_orders!inner(estimate_id, estimates!inner(account_id))")
    .in("work_orders.estimates.account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as unknown as Array<{
    id: string; status: string; price_cents: number | null; customer_token: string | null;
    customer_responded_at: string | null; work_orders: { estimate_id: string } | null;
  }>)
    .filter((v) => v.work_orders?.estimate_id)
    .map((v) => ({
      id: v.id, estimate_id: v.work_orders!.estimate_id, status: v.status,
      price_cents: v.price_cents, customer_token: v.customer_token,
      customer_responded_at: v.customer_responded_at,
    }));
}

export type RebookCandidate = {
  id: string;
  property_id: string | null;
  title: string | null;
  status: string;
  total_cents: number | null;
  created_at: string;
  /** True when the estimate carries its wizard answers — the one-tap rebook
   * can seed the whole walk, not just the address. */
  hasWizard: boolean;
};

/** Prior jobs a trade account can requote — newest first. Only the wizard
 * marker leaves the row; builder_state itself (margins included) never
 * reaches a customer payload. */
export async function getRebookCandidates(accountIds: string[]): Promise<RebookCandidate[]> {
  if (!accountIds.length) return [];
  const svc = createServiceClient();
  if (!svc) return [];
  const { data } = await svc
    .from("estimates")
    .select("id, property_id, title, status, total_cents, created_at, wizard_version:builder_state->wizard->version")
    .in("account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(30);
  return ((data ?? []) as Array<Record<string, unknown>>).map((e) => ({
    id: e.id as string,
    property_id: (e.property_id as string | null) ?? null,
    title: (e.title as string | null) ?? null,
    status: e.status as string,
    total_cents: (e.total_cents as number | null) ?? null,
    created_at: e.created_at as string,
    hasWizard: e.wizard_version != null,
  }));
}

/** Today as yyyy-mm-dd IN MELBOURNE — never toISOString (the CLAUDE.md
 * date rule: before 10am it silently reports yesterday). */
export function melbourneTodayYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Melbourne-clock greeting for the Home header. */
export function melbourneGreeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", hour12: false }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
