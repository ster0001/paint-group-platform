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

  // Read estimates. This list is filtered BY THE DATABASE according to role:
  // staff see all; a customer sees only their own; a contractor sees none here.
  const { data: estimates } = await supabase
    .from("estimates")
    .select("id, status, total_cents")
    .order("created_at", { ascending: false });

  const role = profile?.role ?? "unknown";

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <form action={signout}>
          <button className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">
            Sign out
          </button>
        </form>
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 p-4">
        <div className="text-sm text-gray-500">Signed in as</div>
        <div className="text-lg font-medium">{profile?.name || user.email}</div>
        <div className="text-sm text-gray-500">{user.email}</div>
        <div className="mt-2 inline-block rounded-full bg-gray-100 px-3 py-1 text-sm font-medium capitalize">
          Role: {role}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 p-4">
        <div className="text-sm font-medium">
          Estimates your account is allowed to see
        </div>
        <div className="mt-1 text-sm text-gray-500">
          This list is filtered by the database itself, based on your role.
        </div>

        {estimates && estimates.length > 0 ? (
          <ul className="mt-3 divide-y divide-gray-100">
            {estimates.map((e) => (
              <li key={e.id} className="flex justify-between py-2 text-sm">
                <span className="font-mono text-gray-500">
                  {e.id.slice(0, 8)}…
                </span>
                <span className="capitalize">{e.status}</span>
                <span>{money(e.total_cents)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 text-sm text-gray-400">
            No estimates visible to this account yet.
          </div>
        )}
      </div>
    </main>
  );
}
