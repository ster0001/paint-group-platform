import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signout } from "@/app/auth/actions";

export const dynamic = "force-dynamic";

const money = (cents: number | null) =>
  cents == null ? "—" : `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Read the signed-in user's own profile (RLS: a user may read their own row).
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, name, contact")
    .eq("id", user.id)
    .single();

  // Contractors have their own app — this page is for customers (and staff who
  // navigate here directly).
  if (profile?.role === "contractor") redirect("/portal");

  // Read estimates. This list is filtered BY THE DATABASE according to role:
  // staff see all; a customer sees only their own; a contractor sees none here.
  const { data: estimates } = await supabase
    .from("estimates")
    .select("id, title, status, total_cents")
    .order("created_at", { ascending: false });

  const role = profile?.role ?? "unknown";

  const { data: companyRow } = await supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const logoUrl = (companyRow?.value as { logoUrl?: string } | null)?.logoUrl ?? "";

  return (
    <main>
      {/* dark brand header */}
      <div className="bg-ink text-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-5">
          {logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={logoUrl} alt="Paint Group" className="h-9 w-auto max-w-[200px] object-contain" />
            : <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>}
          <form action={signout}>
            <button className="rounded-md border border-line2 px-3 py-1.5 text-sm font-medium text-gray-300 hover:bg-white/5">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div className="mx-auto max-w-2xl p-6">
      <div className="rounded-lg border border-gray-200 p-4">
        <div className="text-sm text-gray-500">Signed in as</div>
        <div className="text-lg font-medium">{profile?.name || user.email}</div>
        <div className="text-sm text-gray-500">{user.email}</div>
        <div className="mt-2 inline-block rounded-full bg-gray-100 px-3 py-1 text-sm font-medium capitalize">
          Role: {role}
        </div>
        {role === "staff" && (
          <div className="mt-4">
            <Link
              href="/quote"
              className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-accentink hover:bg-paint"
            >
              Open quote builder →
            </Link>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 p-4">
        <div className="text-sm font-medium">
          {role === "staff" ? "Quotes & estimates" : "Estimates your account is allowed to see"}
        </div>
        <div className="mt-1 text-sm text-gray-500">
          {role === "staff"
            ? "Click a quote to reopen it in the builder."
            : "This list is filtered by the database itself, based on your role."}
        </div>

        {estimates && estimates.length > 0 ? (
          <ul className="mt-3 divide-y divide-gray-100">
            {estimates.map((e) => {
              const row = (
                <div className="flex items-center justify-between py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {e.title || <span className="font-mono text-gray-400">{e.id.slice(0, 8)}…</span>}
                  </span>
                  <span className="mx-3 capitalize text-gray-500">{e.status}</span>
                  <span className="tabular-nums">{money(e.total_cents)}</span>
                </div>
              );
              return (
                <li key={e.id}>
                  {role === "staff" ? (
                    <Link href={`/quote?id=${e.id}`} className="block rounded px-1 hover:bg-gray-50">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-3 text-sm text-gray-400">
            No estimates visible to this account yet.
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
