import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CustomerSnapshot } from "@/lib/customer/snapshot";
import CustomerEstimate, { type CustomerChanges, type EstimateRow } from "./CustomerEstimate";

export const dynamic = "force-dynamic";

// Public, token-only. Fetches the SENT snapshot via a security-definer RPC —
// the anon key never gets a `select * from estimates` path, and only the
// customer-safe snapshot is ever returned.
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ portal?: string }>;
}) {
  const { token } = await params;
  const { portal } = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_estimate_by_token", { p_token: token });
  const row = (Array.isArray(data) ? data[0] : data) as EstimateRow | undefined;

  if (error || !row || !row.snapshot) notFound();
  // extra guard: never render anything that isn't a valid customer snapshot
  const snap = row.snapshot as Partial<CustomerSnapshot>;
  if (!snap || snap.version !== 1) notFound();

  // Signed changes + adjusted total (accepted jobs; null before the 20261120
  // migration or when there's nothing to show — the page degrades quietly).
  let changes: CustomerChanges | null = null;
  if (row.status === "accepted") {
    const { data: ch } = await supabase.rpc("estimate_changes_by_token", { p_token: token });
    if (ch && typeof ch === "object" && Array.isArray((ch as CustomerChanges).variations)) {
      changes = ch as CustomerChanges;
    }
  }

  return (
    <CustomerEstimate
      snapshot={row.snapshot}
      token={token}
      status={row.status}
      acceptedName={row.accepted_name}
      validUntil={row.valid_until}
      sentAt={row.sent_at}
      selectedOptionsInit={row.selected_options}
      changes={changes}
      fromPortal={portal === "1"}
    />
  );
}
