"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * 3a-7 · Trade granting is office-side only (⚑2): no self-serve form
 * exists. Find the customer's account by email and flip it — the moment of
 * granting is itself a sales touchpoint ("we've set you up with a trade
 * account"). The unlimited flag (⚑1's unblock) lifts limits WITHOUT making
 * an account trade.
 */

type AccountRow = {
  id: string;
  email: string;
  name: string | null;
  account_type: "residential" | "trade";
  flags: Record<string, unknown> | null;
};

export default function TradeAccountsManager() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [msg, setMsg] = useState("");

  const search = async () => {
    setMsg("");
    const q = query.trim().toLowerCase();
    if (q.length < 3) { setMsg("Type at least a few letters of their email."); return; }
    const { data, error } = await createClient()
      .from("accounts")
      .select("id, email, name, account_type, flags")
      .ilike("email", `%${q}%`)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) { setMsg(`Couldn't search: ${error.message}`); return; }
    setRows((data ?? []) as AccountRow[]);
    if (!data?.length) setMsg("No account with that email yet — they get one the first time they save an estimate.");
  };

  const setType = async (row: AccountRow, type: "residential" | "trade") => {
    const { error } = await createClient().from("accounts").update({ account_type: type }).eq("id", row.id);
    if (error) { setMsg(`Couldn't update: ${error.message}`); return; }
    setRows((r) => r.map((x) => (x.id === row.id ? { ...x, account_type: type } : x)));
    setMsg(type === "trade"
      ? `${row.email} is a trade account now — unlimited estimates, portfolio view. Worth a call to tell them.`
      : `${row.email} is back to residential.`);
  };

  const setUnlimited = async (row: AccountRow, unlimited: boolean) => {
    const flags = { ...(row.flags ?? {}), unlimited };
    const { error } = await createClient().from("accounts").update({ flags }).eq("id", row.id);
    if (error) { setMsg(`Couldn't update: ${error.message}`); return; }
    setRows((r) => r.map((x) => (x.id === row.id ? { ...x, flags } : x)));
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Search by customer email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accentink" onClick={search}>
          Find
        </button>
      </div>
      {msg && <div className="text-sm text-gray-600">{msg}</div>}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <b>{row.email}</b>{row.name ? ` · ${row.name}` : ""}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.account_type === "trade" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"}`}>
              {row.account_type}
            </span>
            {row.account_type === "trade" ? (
              <button className="text-gray-500 hover:underline" onClick={() => setType(row, "residential")}>Make residential</button>
            ) : (
              <button className="font-medium text-emerald-700 hover:underline" onClick={() => setType(row, "trade")}>Grant trade</button>
            )}
            <label className="flex items-center gap-1 text-gray-600">
              <input
                type="checkbox"
                checked={row.flags?.unlimited === true}
                onChange={(e) => setUnlimited(row, e.target.checked)}
              />
              unblocked
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
