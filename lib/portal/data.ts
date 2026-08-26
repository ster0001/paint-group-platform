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

  const [{ data: memberships }, { data: profile }, company] = await Promise.all([
    supabase.from("account_users").select("account_id, role"),
    supabase.from("profiles").select("name").eq("id", user.id).maybeSingle(),
    getCompanyContact(),
  ]);

  const accountIds = (memberships ?? []).map((m) => m.account_id as string);
  let accounts: PortalAccount[] = [];
  let properties: PortalProperty[] = [];
  if (accountIds.length) {
    const [a, p] = await Promise.all([
      supabase.from("accounts").select("id, account_type, email, name, phone").in("id", accountIds),
      supabase.from("properties").select("id, account_id, address, suburb, postcode").in("account_id", accountIds),
    ]);
    accounts = (a.data ?? []) as PortalAccount[];
    properties = (p.data ?? []) as PortalProperty[];
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

  const { data: estimates } = await svc
    .from("estimates")
    .select("id, title, status, source, total_cents, share_token, sent_at, created_at")
    .in("account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(50);

  const ids = (estimates ?? []).map((e) => e.id as string);
  let workOrders: PortalWorkOrder[] = [];
  if (ids.length) {
    const { data: wos } = await svc
      .from("work_orders")
      .select("estimate_id, stage, start_date, end_date")
      .in("estimate_id", ids);
    workOrders = (wos ?? []) as PortalWorkOrder[];
  }
  return { estimates: (estimates ?? []) as PortalEstimate[], workOrders };
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
