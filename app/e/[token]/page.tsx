import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CustomerSnapshot } from "@/lib/customer/snapshot";
import CustomerEstimate, { type EstimateRow } from "./CustomerEstimate";

export const dynamic = "force-dynamic";

// Public, token-only. Fetches the SENT snapshot via a security-definer RPC —
// the anon key never gets a `select * from estimates` path, and only the
// customer-safe snapshot is ever returned.
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_estimate_by_token", { p_token: token });
  const row = (Array.isArray(data) ? data[0] : data) as EstimateRow | undefined;

  if (error || !row || !row.snapshot) notFound();
  // extra guard: never render anything that isn't a valid customer snapshot
  const snap = row.snapshot as Partial<CustomerSnapshot>;
  if (!snap || snap.version !== 1) notFound();

  return <CustomerEstimate token={token} row={row} />;
}
