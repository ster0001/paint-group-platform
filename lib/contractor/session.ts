import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CONTRACTOR_COLUMNS, type ContractorRow } from "./model";

// Server-only. Types and pure helpers live in ./model so Client Components can
// share them without pulling `next/headers` into the browser bundle.

export type ContractorSession = {
  userId: string;
  email: string;
  name: string;
  /** null when the profile is a contractor but staff haven't created their contractors row yet. */
  contractor: ContractorRow | null;
};

/**
 * Role gate WITHOUT the suspension check. Used by the portal layout and the
 * suspended notice itself — both of which have to render for a suspended
 * contractor, and would otherwise redirect to themselves forever.
 */
export async function getContractorSession(): Promise<ContractorSession> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, name")
    .eq("id", user.id)
    .single();

  if (profile?.role === "staff") redirect("/estimates");
  if (profile?.role !== "contractor") redirect("/dashboard");

  // RLS: a contractor can only ever read their own row, so no filter is needed —
  // but we filter anyway so the intent is obvious from the code.
  const { data: contractor } = await supabase
    .from("contractors")
    .select(CONTRACTOR_COLUMNS)
    .eq("profile_id", user.id)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email ?? "",
    name: profile?.name || user.email || "",
    contractor: (contractor as ContractorRow | null) ?? null,
  };
}

/**
 * Gate for every /portal DATA page. Sends anyone who isn't a contractor to the
 * part of the app that belongs to them, and a suspended contractor to the
 * notice.
 *
 * The redirect matters for more than tidiness: hiding a suspended contractor's
 * pages in the layout still let those pages run and ship their data to the
 * browser. Stopping here means the query never happens.
 */
export async function requireContractor(): Promise<ContractorSession> {
  const session = await getContractorSession();
  if (session.contractor && !session.contractor.active) redirect("/portal/suspended");
  return session;
}
