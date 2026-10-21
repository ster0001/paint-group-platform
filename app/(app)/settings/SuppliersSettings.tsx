"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BRANCH_KINDS, type BranchKind } from "@/lib/movements/types";
import { setSupplierBranchAccount, upsertSupplierBranch } from "@/app/pc/movements/actions";

export type BranchFull = {
  id: string; brand: string; branch: string; kind: BranchKind; address: string; suburb: string; postcode: string; phone: string; email: string;
  map_place_id: string; lat: number | null; lng: number | null; delivers_to_site: boolean; opens_weekday: string | null; favourite: boolean; active: boolean; notes: string;
  /** The trade account reference, masked by the server to its last four characters; null = none set. */
  accountMasked: string | null;
};

type Draft = { id?: string; brand: string; branch: string; kind: BranchKind; address: string; suburb: string; postcode: string; phone: string; email: string; opensWeekday: string; deliversToSite: boolean; favourite: boolean; active: boolean; notes: string };
const empty: Draft = { brand: "", branch: "", kind: "paint", address: "", suburb: "", postcode: "", phone: "", email: "", opensWeekday: "", deliversToSite: false, favourite: false, active: true, notes: "" };
const field = "rounded border border-gray-300 px-2 py-1 text-sm";

/**
 * Settings → Suppliers (brief §3.1, ruling 5): every branch hangs off its brand's vendor;
 * active / favourite / delivers / opening time drive the chip sheet's nearest-first list
 * and the Supplier lane's refusal. The trade account reference is saved to its own
 * staff-only table and shown masked after save (never in the repo, never to a painter).
 */
export default function SuppliersSettings({ initial }: { initial: BranchFull[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [kind, setKind] = useState<BranchKind | "all">("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [account, setAccount] = useState<Record<string, string>>({});
  const rows = useMemo(() => initial.filter((b) => kind === "all" || b.kind === kind).sort((a, b) => a.brand.localeCompare(b.brand) || a.branch.localeCompare(b.branch)), [initial, kind]);
  const brands = useMemo(() => [...new Set(rows.map((b) => b.brand))], [rows]);

  const save = () => start(async () => {
    if (!draft) return;
    setMsg("");
    const r = await upsertSupplierBranch({
      id: draft.id, brand: draft.brand.trim(), branch: draft.branch.trim(), kind: draft.kind, address: draft.address.trim(), suburb: draft.suburb.trim(), postcode: draft.postcode.trim(),
      phone: draft.phone.trim(), email: draft.email.trim(), opensWeekday: draft.opensWeekday || null, deliversToSite: draft.deliversToSite, favourite: draft.favourite, active: draft.active, notes: draft.notes.trim(),
    });
    setMsg(r.ok ? "Saved." : r.message);
    if (r.ok) { setDraft(null); router.refresh(); }
  });
  const quick = (b: BranchFull, patch: Partial<{ active: boolean; favourite: boolean; deliversToSite: boolean }>) => start(async () => {
    setMsg("");
    const r = await upsertSupplierBranch({ id: b.id, brand: b.brand, branch: b.branch, kind: b.kind, ...patch });
    setMsg(r.ok ? "Saved." : r.message);
    if (r.ok) router.refresh();
  });
  const saveAccount = (b: BranchFull) => start(async () => {
    setMsg("");
    const r = await setSupplierBranchAccount({ branchId: b.id, accountRef: (account[b.id] ?? "").trim() });
    setMsg(r.ok ? (r.value === "cleared" ? "Account cleared." : "Account saved — shown masked from now on.") : r.message);
    if (r.ok) { setAccount({ ...account, [b.id]: "" }); router.refresh(); }
  });
  const edit = (b: BranchFull) => setDraft({ id: b.id, brand: b.brand, branch: b.branch, kind: b.kind, address: b.address, suburb: b.suburb, postcode: b.postcode, phone: b.phone, email: b.email, opensWeekday: b.opens_weekday?.slice(0, 5) ?? "", deliversToSite: b.delivers_to_site, favourite: b.favourite, active: b.active, notes: b.notes });

  return (
    <div className="space-y-4" data-testid="suppliers-settings">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", ...BRANCH_KINDS] as const).map((k) => <button key={k} type="button" className={`rounded-full border px-3 py-1 text-xs ${kind === k ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300"}`} onClick={() => setKind(k)} data-testid={`sup-kind-${k}`}>{k === "all" ? "All" : k} {k === "all" ? initial.length : initial.filter((b) => b.kind === k).length}</button>)}
        <button type="button" className="ml-auto rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white" onClick={() => setDraft({ ...empty })} data-testid="sup-add">Add a branch</button>
      </div>
      {msg && <p className="text-sm text-gray-600" data-testid="sup-msg">{msg}</p>}
      {draft && (
        <div className="grid gap-2 rounded-md border border-gray-300 p-3 sm:grid-cols-3" data-testid="sup-form">
          <label className="text-sm"><span className="text-gray-700">Brand</span><input className={`${field} w-full`} value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} data-testid="sup-brand" /></label>
          <label className="text-sm"><span className="text-gray-700">Branch</span><input className={`${field} w-full`} value={draft.branch} onChange={(e) => setDraft({ ...draft, branch: e.target.value })} data-testid="sup-branch" /></label>
          <label className="text-sm"><span className="text-gray-700">Kind</span><select className={`${field} w-full`} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as BranchKind })} data-testid="sup-kind">{BRANCH_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
          <label className="text-sm"><span className="text-gray-700">Address</span><input className={`${field} w-full`} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} data-testid="sup-address" /></label>
          <label className="text-sm"><span className="text-gray-700">Suburb (its centroid places the shop)</span><input className={`${field} w-full`} value={draft.suburb} onChange={(e) => setDraft({ ...draft, suburb: e.target.value })} data-testid="sup-suburb" /></label>
          <label className="text-sm"><span className="text-gray-700">Postcode</span><input className={`${field} w-full`} value={draft.postcode} onChange={(e) => setDraft({ ...draft, postcode: e.target.value })} data-testid="sup-postcode" /></label>
          <label className="text-sm"><span className="text-gray-700">Phone</span><input className={`${field} w-full`} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} data-testid="sup-phone" /></label>
          <label className="text-sm"><span className="text-gray-700">Email (orders, later — ⚑8)</span><input className={`${field} w-full`} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} data-testid="sup-email" /></label>
          <label className="text-sm"><span className="text-gray-700">Opens (weekdays)</span><input type="time" className={`${field} w-full`} value={draft.opensWeekday} onChange={(e) => setDraft({ ...draft, opensWeekday: e.target.value })} data-testid="sup-opens" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.deliversToSite} onChange={(e) => setDraft({ ...draft, deliversToSite: e.target.checked })} data-testid="sup-delivers" /> Delivers to site</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.favourite} onChange={(e) => setDraft({ ...draft, favourite: e.target.checked })} /> Favourite (first in the chip sheet)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active</label>
          <label className="text-sm sm:col-span-3"><span className="text-gray-700">Notes</span><input className={`${field} w-full`} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
          <div className="flex gap-2 sm:col-span-3">
            <button type="button" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40" disabled={pending || !draft.brand.trim() || !draft.branch.trim()} onClick={save} data-testid="sup-save">Save branch</button>
            <button type="button" className="text-sm text-gray-500" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
      {brands.map((brand) => (
        <div key={brand} data-testid={`sup-brand-group`}>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{brand}</h4>
          <div className="divide-y divide-gray-200 rounded-md border border-gray-200">
            {rows.filter((b) => b.brand === brand).map((b) => (
              <div key={b.id} className={`flex flex-wrap items-center gap-3 px-3 py-2 text-sm ${b.active ? "" : "opacity-60"}`} data-testid={`sup-row-${b.id}`} data-active={b.active}>
                <span className="font-medium">{b.branch}</span>
                <span className="text-xs text-gray-500">{[b.kind, b.address, b.suburb, b.phone, b.opens_weekday ? `from ${b.opens_weekday.slice(0, 5)}` : null].filter(Boolean).join(" · ")}</span>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={b.delivers_to_site} onChange={(e) => quick(b, { deliversToSite: e.target.checked })} /> delivers</label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={b.favourite} onChange={(e) => quick(b, { favourite: e.target.checked })} /> favourite</label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={b.active} onChange={(e) => quick(b, { active: e.target.checked })} data-testid={`sup-active-${b.id}`} /> active</label>
                <span className="ml-auto flex items-center gap-2 text-xs">
                  <span className="font-mono text-gray-500" data-testid={`sup-account-${b.id}`}>{b.accountMasked ? `account ${b.accountMasked}` : "no account"}</span>
                  <input className={`${field} w-32`} placeholder="account ref" value={account[b.id] ?? ""} onChange={(e) => setAccount({ ...account, [b.id]: e.target.value })} data-testid={`sup-account-input-${b.id}`} />
                  <button type="button" className="rounded-md border border-gray-300 px-2 py-1" disabled={pending} onClick={() => saveAccount(b)} data-testid={`sup-account-save-${b.id}`}>Set</button>
                  <button type="button" className="underline" onClick={() => edit(b)} data-testid={`sup-edit-${b.id}`}>Edit</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="text-sm text-gray-500">No branches — run `npx tsx scripts/seed-suppliers.ts` for the 69 seeded ones, or add one above.</p>}
    </div>
  );
}
