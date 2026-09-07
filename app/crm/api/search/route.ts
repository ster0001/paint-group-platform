import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LANES } from "@/lib/crm/stage";
import type { SearchHit } from "../../Search";

/**
 * P2 — global search. Staff session + RLS; the facts table carries a search
 * column (name, email, phone with and without spaces, suburb, address) with a
 * trigram index, and estimates are matched on title. Small, bounded, fast.
 */
export const dynamic = "force-dynamic";

const money = (c: number | null) => (c == null ? "" : "$" + Math.round(c / 100).toLocaleString("en-AU"));

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const needle = q.toLowerCase().replace(/[%_]/g, "");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no" }, { status: 401 });

  const [accounts, estimates] = await Promise.all([
    supabase.from("crm_account_facts")
      .select("account_id, name, email, phone, suburb, stage, because")
      .ilike("search", `%${needle}%`)
      .order("needs_you", { ascending: false })
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(8),
    supabase.from("estimates")
      .select("id, title, status, total_cents, account_id")
      .ilike("title", `%${needle}%`)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const laneLabel = (k: string) => LANES.find((l) => l.key === k)?.label ?? k;
  const hits: SearchHit[] = [
    ...((accounts.data ?? []) as Array<{ account_id: string; name: string | null; email: string | null; phone: string | null; suburb: string | null; stage: string; because: string }>)
      .map((a) => ({
        kind: "account" as const,
        id: a.account_id,
        name: a.name || a.email || a.phone || "Unnamed",
        line: [a.phone, a.suburb, laneLabel(a.stage), a.because].filter(Boolean).join(" · "),
        stage: a.stage,
      })),
    ...((estimates.data ?? []) as Array<{ id: string; title: string | null; status: string; total_cents: number | null; account_id: string | null }>)
      .map((e) => ({
        kind: "estimate" as const,
        id: e.id,
        accountId: e.account_id,
        title: e.title || "Untitled estimate",
        line: [e.status, money(e.total_cents)].filter(Boolean).join(" · "),
      })),
  ];
  return NextResponse.json({ hits });
}
