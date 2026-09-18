import { createClient } from "@/lib/supabase/server";
import { CONTRACTOR_COLUMNS, type ContractorRow, type ContractorDoc, DOC_COLUMNS } from "@/lib/contractor/model";
import { weekendAvailability } from "@/lib/contractor/weekend";
import { EMPLOYEES_ENABLED_KEY, employeesSwitchFrom } from "@/lib/painters/employeesFlag";
import { reportError } from "@/lib/monitoring/report";
import { isEmploymentType } from "@/lib/painters/capabilities";
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
    supabase.from("contractors").select(`${CONTRACTOR_COLUMNS}, requires_qa, qa_mode, rcti_agreement_signed_at, profiles ( name )`).order("company_name"),
    supabase.from("contractor_documents").select(DOC_COLUMNS),
    supabase
      .from("contractor_invites")
      .select("id, email, name, company_name, tier, token, created_at, expires_at, accepted_at, revoked_at, emailed_at, emailed_count")
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

  // Best-effort: an empty map until migration 20261221 runs → weekend = null
  // per contractor and the Sat/Sun controls stay hidden.
  const weekendMap = await weekendAvailability(
    supabase,
    ((rows as Row[] | null) ?? []).map((c) => c.id),
  );
  // Employed painters (S5): the type per row (best-effort, the works_saturday
  // rule — a missing column reads as contractor) and the office's switch.
  const [{ data: typeRows, error: typeErr }, { data: flagRow, error: flagErr }, { data: rateRows, error: rateErr }] = await Promise.all([
    supabase.from("contractors").select("id, employment_type"),
    supabase.from("settings").select("value").eq("key", EMPLOYEES_ENABLED_KEY).maybeSingle(),
    // Session 6: the cost rate in force per employee — newest effective_from
    // on or before today wins. Staff-only table; a refused read is reported.
    supabase.from("employee_cost_rates").select("contractor_id, cents_per_hour, effective_from")
      .lte("effective_from", new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date()))
      .order("effective_from", { ascending: false }),
  ]);
  if (rateErr) reportError(rateErr, { where: "contractors.costRates" });
  const rateOf = new Map<string, number>();
  for (const r of (rateErr ? [] : rateRows ?? []) as { contractor_id: string; cents_per_hour: number }[]) {
    if (!rateOf.has(r.contractor_id)) rateOf.set(r.contractor_id, r.cents_per_hour);
  }
  // Both degrade to the proven type (contractor) and the safe switch (off);
  // a refused read is reported, never silently absorbed.
  if (typeErr) reportError(typeErr, { where: "contractors.employmentType" });
  if (flagErr) reportError(flagErr, { where: "contractors.employeesFlag" });
  const typeOf = new Map(((typeErr ? [] : typeRows ?? []) as { id: string; employment_type?: unknown }[])
    .map((r) => [r.id, isEmploymentType(r.employment_type) ? r.employment_type : "contractor" as const]));
  const employeesEnabled = !flagErr && employeesSwitchFrom((flagRow as { value?: unknown } | null)?.value).enabled;

  const contractors: ContractorSummary[] = ((rows as Row[] | null) ?? []).map((c) => ({
    id: c.id,
    name: c.profiles?.name || c.company_name || "Contractor",
    company: c.company_name ?? "",
    tier: c.tier ?? "",
    crewSize: c.crew_size ?? 1,
    active: c.active,
    offerable: c.offerable,
    // A row from before the qa_mode column reads through the old boolean.
    qaMode: (() => {
      const m = (c as Row & { qa_mode?: unknown }).qa_mode;
      return m === "every_job" || m === "none" || m === "first_jobs" ? m
        : (c as Row & { requires_qa?: boolean }).requires_qa ? "every_job" : "first_jobs";
    })(),
    // ⚑9: the RCTI switch is inert until the agreement is recorded as signed.
    rctiSigned: Boolean((c as Row & { rcti_agreement_signed_at?: string | null }).rcti_agreement_signed_at),
    abn: c.abn ?? "",
    hasBank: Boolean(c.bank_account_last4),
    docs: allDocs.filter((d) => d.contractor_id === c.id),
    liveOffers: allOffers.filter((o) => o.contractor_id === c.id && ["offered", "proposed"].includes(o.state)).length,
    bookedJobs: allOffers.filter((o) => o.contractor_id === c.id && o.state === "accepted").length,
    weekend: weekendMap.get(c.id) ?? null,
    employmentType: typeOf.get(c.id) ?? "contractor",
    costRateCents: rateOf.get(c.id) ?? null,
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
      employeesEnabled={employeesEnabled}
    />
  );
}
