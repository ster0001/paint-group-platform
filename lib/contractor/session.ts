import { cache } from "react";
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

/** Where the caller should be sent, or the session if they belong here. */
type Loaded =
  | { kind: "anon" }
  | { kind: "staff" }
  | { kind: "other" }
  | { kind: "contractor"; session: ContractorSession };

/**
 * The three queries behind the gate: getUser, profiles, contractors.
 *
 * Wrapped in React's `cache` so they run ONCE per request. Every portal page
 * was paying for them twice — the layout calls `getContractorSession` and the
 * page calls `requireContractor` — which is three redundant round trips on
 * every single portal view (audit finding S5).
 *
 * `cache` is per-request, not a shared or persisted cache: nothing here is held
 * between requests or between users, which for an auth check matters rather a
 * lot.
 *
 * It returns a decision rather than redirecting, deliberately: `redirect()`
 * works by throwing, and a cached function that throws caches the throw. Doing
 * the redirecting in the callers keeps the cached value plain data.
 */
const loadSession = cache(async (): Promise<Loaded> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "anon" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, name")
    .eq("id", user.id)
    .single();

  if (profile?.role === "staff") return { kind: "staff" };
  if (profile?.role !== "contractor") return { kind: "other" };

  // RLS: a contractor can only ever read their own row, so no filter is needed —
  // but we filter anyway so the intent is obvious from the code.
  const { data: contractor } = await supabase
    .from("contractors")
    .select(CONTRACTOR_COLUMNS)
    .eq("profile_id", user.id)
    .maybeSingle();

  return {
    kind: "contractor",
    session: {
      userId: user.id,
      email: user.email ?? "",
      name: profile?.name || user.email || "",
      contractor: (contractor as ContractorRow | null) ?? null,
    },
  };
});

/**
 * Role gate WITHOUT the suspension check. Used by the portal layout and the
 * suspended notice itself — both of which have to render for a suspended
 * contractor, and would otherwise redirect to themselves forever.
 */
export async function getContractorSession(): Promise<ContractorSession> {
  const loaded = await loadSession();
  if (loaded.kind === "anon") redirect("/login");
  if (loaded.kind === "staff") redirect("/estimates");
  if (loaded.kind === "other") redirect("/dashboard");
  return loaded.session;
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
