import { createClient } from "@/lib/supabase/server";
import { CONTRACTOR_COLUMNS, type ContractorRow, type ContractorDoc, DOC_COLUMNS } from "@/lib/contractor/model";
import ContractorsManager, { type BankAlert, type ContractorSummary, type InviteRow } from "./ContractorsManager";

export const dynamic = "force-dynamic";

/** jsonb comes back as unknown — read it without trusting its shape. */
function str(detail: unknown, key: string): string {
  const v = (detail as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : "";
}

// Formatted here, on the server, with the timezone stated: the alert is read by
// staff in Melbourne, and "which evening did this happen" is the whole point of
// showing a time next to a bank change.
const whenFmt = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Australia/Melbourne",
});

// Staff-only — the (app) layout redirects anyone who isn't staff.
export default async function ContractorsPage() {
  const supabase = await createClient();

  const [{ data: rows }, { data: docs }, { data: invites }, { data: offers }, { data: events }] = await Promise.all([
    supabase.from("contractors").select(`${CONTRACTOR_COLUMNS}, profiles ( name )`).order("company_name"),
    supabase.from("contractor_documents").select(DOC_COLUMNS),
    supabase
      .from("contractor_invites")
      .select("id, email, name, company_name, tier, token, created_at, expires_at, accepted_at, revoked_at")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    // Only the states this page counts — it was reading every offer ever made
    // to work out two numbers per contractor (audit S6).
    supabase.from("booking_offers").select("contractor_id, state").in("state", ["offered", "proposed", "accepted"]),
    // Bank changes staff haven't looked at yet. Degrades to null (no banner)
    // until migration 20260906000000 adds acknowledged_at.
    supabase
      .from("contractor_events")
      .select("id, contractor_id, detail, created_at")
      .eq("type", "bank_changed")
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  type Row = ContractorRow & { profiles: { name: string | null } | null };
  const allDocs = (docs as ContractorDoc[] | null) ?? [];
  const allOffers = (offers as { contractor_id: string; state: string }[] | null) ?? [];

  const contractors: ContractorSummary[] = ((rows as Row[] | null) ?? []).map((c) => ({
    id: c.id,
    name: c.profiles?.name || c.company_name || "Contractor",
    company: c.company_name ?? "",
    tier: c.tier ?? "",
    crewSize: c.crew_size ?? 1,
    active: c.active,
    offerable: c.offerable,
    requiresQa: Boolean((c as Row & { requires_qa?: boolean }).requires_qa),
    abn: c.abn ?? "",
    hasBank: Boolean(c.bank_account_last4),
    docs: allDocs.filter((d) => d.contractor_id === c.id),
    liveOffers: allOffers.filter((o) => o.contractor_id === c.id && ["offered", "proposed"].includes(o.state)).length,
    bookedJobs: allOffers.filter((o) => o.contractor_id === c.id && o.state === "accepted").length,
  }));

  type EventRow = { id: string; contractor_id: string; detail: unknown; created_at: string };
  const bankAlerts: BankAlert[] = ((events as EventRow[] | null) ?? []).map((e) => ({
    id: e.id,
    contractorId: e.contractor_id,
    // The event is the record, so it keeps its own name even if the contractor
    // row is later renamed.
    name: contractors.find((c) => c.id === e.contractor_id)?.name ?? "A contractor",
    when: whenFmt.format(new Date(e.created_at)),
    bsb: str(e.detail, "bsb"),
    last4: str(e.detail, "last4"),
    prevBsb: str(e.detail, "prev_bsb"),
    prevLast4: str(e.detail, "prev_last4"),
    firstTime: (e.detail as Record<string, unknown> | null)?.first_time === true,
  }));

  return (
    <ContractorsManager
      contractors={contractors}
      invites={(invites as InviteRow[] | null) ?? []}
      bankAlerts={bankAlerts}
    />
  );
}
