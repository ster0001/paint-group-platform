import { createClient } from "@/lib/supabase/server";
import { CONTRACTOR_COLUMNS, type ContractorRow, type ContractorDoc, DOC_COLUMNS } from "@/lib/contractor/model";
import ContractorsManager, { type ContractorSummary, type InviteRow } from "./ContractorsManager";

export const dynamic = "force-dynamic";

// Staff-only — the (app) layout redirects anyone who isn't staff.
export default async function ContractorsPage() {
  const supabase = await createClient();

  const [{ data: rows }, { data: docs }, { data: invites }, { data: offers }] = await Promise.all([
    supabase.from("contractors").select(`${CONTRACTOR_COLUMNS}, profiles ( name )`).order("company_name"),
    supabase.from("contractor_documents").select(DOC_COLUMNS),
    supabase
      .from("contractor_invites")
      .select("id, email, name, company_name, tier, token, created_at, expires_at, accepted_at, revoked_at")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("booking_offers").select("contractor_id, state"),
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
    abn: c.abn ?? "",
    hasBank: Boolean(c.bank_account_last4),
    docs: allDocs.filter((d) => d.contractor_id === c.id),
    liveOffers: allOffers.filter((o) => o.contractor_id === c.id && ["offered", "proposed"].includes(o.state)).length,
    bookedJobs: allOffers.filter((o) => o.contractor_id === c.id && o.state === "accepted").length,
  }));

  return (
    <ContractorsManager
      contractors={contractors}
      invites={(invites as InviteRow[] | null) ?? []}
    />
  );
}
