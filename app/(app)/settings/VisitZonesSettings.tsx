"use client";

import { useMemo, useState } from "react";
import { ZONE_KEYS, ZONE_STATUSES, ZONE_STATUS_LABEL, type Resolution, type SuburbRow, type VisitZonesData, type ZoneStatus } from "@/lib/visits/zones";
import { addSuburbAction, approveSuburbsAction, checkSuburbAction, dismissUnmappedAction, removeSuburbAction, setSuburbFarEdgeAction, setSuburbStatusAction, setZoneEstimatorAction } from "./visitZonesActions";

/**
 * Settings → Visit zones (addendum A §6). Which suburb is in which zone, the
 * far-edge tick, whether Tom has reviewed each row, and which estimator covers
 * each zone. Filter by status, move suburbs, approve in bulk, add one. The
 * resolver reads the same table, so a change here is live at once.
 */

type Filter = "all" | ZoneStatus | "unreviewed" | "far_edge";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  ...ZONE_KEYS.map((k) => ({ key: k as Filter, label: ZONE_STATUS_LABEL[k] })),
  { key: "pre_arranged", label: "Pre-arranged" },
  { key: "out_of_area", label: "Out of area" },
  { key: "unreviewed", label: "Not yet reviewed" },
  { key: "far_edge", label: "Far edge" },
];
const PAGE = 150;

const chip: Record<ZoneStatus, string> = {
  zone_1: "bg-emerald-100 text-emerald-800", zone_2: "bg-sky-100 text-sky-800", zone_3: "bg-violet-100 text-violet-800",
  zone_4: "bg-amber-100 text-amber-800", zone_5: "bg-rose-100 text-rose-800",
  pre_arranged: "bg-gray-200 text-gray-800", out_of_area: "bg-gray-100 text-gray-500",
};

function outcomeWords(r: Resolution): string {
  const where = r.row ? ` (${r.row.suburb} ${r.row.postcode})` : "";
  if (r.outcome === "unmapped") return "Unmapped — this suburb is not in the list. A customer here would be sent to request a time and the suburb raised on Today.";
  if (r.outcome === "out_of_area") return r.basis === "not_victoria" ? "Out of area — not a Victorian address." : `Out of area${where}: no calendar, a message only.`;
  if (r.outcome === "pre_arranged") return `Pre-arranged${where}: the customer requests a time and staff confirm it.`;
  return `${ZONE_STATUS_LABEL[r.outcome]}${r.farEdge ? ", far edge" : ""}${where}: books into that zone's slots.${r.basis === "suburb_only_unique" ? " Matched by suburb name — the postcode given did not match." : ""}`;
}

export default function VisitZonesSettings({ initial }: { initial: VisitZonesData }) {
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState({ suburb: "", postcode: "", status: "zone_1" as ZoneStatus, farEdge: false });
  const [check, setCheck] = useState({ suburb: "", postcode: "" });
  const [checked, setChecked] = useState<string>("");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of data.suburbs) c[s.status] = (c[s.status] ?? 0) + 1;
    c.unreviewed = data.suburbs.filter((s) => !s.reviewed).length;
    c.far_edge = data.suburbs.filter((s) => s.far_edge).length;
    return c;
  }, [data.suburbs]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.suburbs.filter((s) => {
      if (filter === "unreviewed" && s.reviewed) return false;
      if (filter === "far_edge" && !s.far_edge) return false;
      if (filter !== "all" && filter !== "unreviewed" && filter !== "far_edge" && s.status !== filter) return false;
      if (needle && !(s.suburb.toLowerCase().includes(needle) || s.postcode.startsWith(needle))) return false;
      return true;
    });
  }, [data.suburbs, filter, q]);
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE);

  async function run(label: string, fn: () => Promise<{ ok: true } | { ok: false; message: string }>, apply: () => void) {
    setBusy(true); setMsg("");
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setMsg(r.message); return; }
    apply();
    setMsg(label);
  }

  const patchRows = (ids: string[], next: Partial<SuburbRow>) =>
    setData((d) => ({ ...d, suburbs: d.suburbs.map((s) => (ids.includes(s.id) ? { ...s, ...next } : s)) }));

  async function moveSelected(status: ZoneStatus) {
    const ids = [...selected];
    if (!ids.length) return;
    await run(`Moved ${ids.length} suburb${ids.length === 1 ? "" : "s"} to ${ZONE_STATUS_LABEL[status]}. Live for the next customer.`,
      () => setSuburbStatusAction({ ids, status }), () => { patchRows(ids, { status, reviewed: true, basis: "settings" }); setSelected(new Set()); });
  }
  async function moveOne(s: SuburbRow, status: ZoneStatus) {
    await run(`${s.suburb} ${s.postcode} is now ${ZONE_STATUS_LABEL[status]}. Live for the next customer.`,
      () => setSuburbStatusAction({ ids: [s.id], status }), () => patchRows([s.id], { status, reviewed: true, basis: "settings" }));
  }
  async function approveShown() {
    const ids = shown.filter((s) => !s.reviewed).map((s) => s.id).slice(0, 500);
    if (!ids.length) { setMsg("Everything shown is already reviewed."); return; }
    await run(`Approved ${ids.length} suburb${ids.length === 1 ? "" : "s"}.`, () => approveSuburbsAction({ ids }), () => patchRows(ids, { reviewed: true }));
  }
  async function addOne(unmappedId?: string, preset?: { suburb: string; postcode: string }) {
    const body = preset ? { ...add, ...preset } : add;
    await run(`Added ${body.suburb} ${body.postcode} as ${ZONE_STATUS_LABEL[body.status]}.`,
      () => addSuburbAction({ ...body, unmappedId }),
      () => {
        setData((d) => ({
          ...d,
          suburbs: [...d.suburbs.filter((s) => !(s.suburb.toLowerCase() === body.suburb.trim().toLowerCase() && s.postcode === body.postcode)),
            { id: `new-${Date.now()}`, suburb: body.suburb.trim(), postcode: body.postcode, status: body.status, far_edge: body.farEdge, reviewed: true, basis: "settings", lat: null, lng: null }]
            .sort((a, b) => a.suburb.localeCompare(b.suburb)),
          unmapped: d.unmapped.filter((u) => !(u.suburb.toLowerCase() === body.suburb.trim().toLowerCase() && u.postcode === body.postcode) && u.id !== unmappedId),
        }));
        setAdd({ suburb: "", postcode: "", status: add.status, farEdge: false });
      });
  }
  async function doCheck() {
    setMsg(""); setChecked("");
    const r = await checkSuburbAction(check);
    setChecked(r.ok ? outcomeWords(r.result) : r.message);
  }

  return (
    <div className="space-y-6" data-testid="visit-zones">
      {data.loadError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="visit-zones-load-error">{data.loadError}</p>
      )}

      {/* Zones and their estimators */}
      <div>
        <p className="text-sm font-medium text-gray-900">The five zones and who covers them</p>
        <p className="text-xs text-gray-500">A zone belongs to one estimator at a time. Customers in a zone see that estimator&rsquo;s free slots.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.zones.map((z) => (
            <div key={z.key} className="rounded-md border border-gray-200 p-3" data-testid={`zone-${z.key}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${chip[z.key]}`}>{ZONE_STATUS_LABEL[z.key]}</span>
                <span className="text-xs text-gray-500">{counts[z.key] ?? 0} suburbs</span>
              </div>
              <p className="mt-1 text-xs text-gray-600">{z.label.replace(/^Zone \d — /, "")}</p>
              <select className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm" value={z.estimator_id ?? ""} data-testid={`zone-${z.key}-estimator`}
                onChange={(e) => {
                  const id = e.target.value || null;
                  void run(id ? `${ZONE_STATUS_LABEL[z.key]} is covered by ${data.staff.find((s) => s.id === id)?.name ?? "that person"}.` : `${ZONE_STATUS_LABEL[z.key]} has no estimator.`,
                    () => setZoneEstimatorAction({ zone: z.key, estimatorId: id }),
                    () => setData((d) => ({ ...d, zones: d.zones.map((x) => (x.key === z.key ? { ...x, estimator_id: id, estimator_name: data.staff.find((s) => s.id === id)?.name ?? null } : x)) })));
                }}>
                <option value="">No estimator yet</option>
                {data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Unmapped */}
      {data.unmapped.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3" data-testid="unmapped-list">
          <p className="text-sm font-medium text-amber-900">Suburbs customers typed that are not in the list</p>
          <p className="text-xs text-amber-800">Each one was sent to request a time. Add it so the next customer gets a straight answer, or dismiss a typo.</p>
          <ul className="mt-2 space-y-1">
            {data.unmapped.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid={`unmapped-${u.id}`}>
                <span className="font-medium text-gray-900">{u.suburb}{u.postcode ? ` ${u.postcode}` : ""}</span>
                <span className="text-xs text-gray-500">{u.hits} hit{u.hits === 1 ? "" : "s"}</span>
                <select className="rounded-md border border-gray-300 px-2 py-0.5 text-xs" defaultValue="" disabled={busy || !u.postcode}
                  onChange={(e) => { if (e.target.value) void addOne(u.id, { suburb: u.suburb, postcode: u.postcode }).then(() => undefined); setAdd((a) => ({ ...a, status: e.target.value as ZoneStatus })); }}>
                  <option value="">Add as…</option>
                  {ZONE_STATUSES.map((st) => <option key={st} value={st}>{ZONE_STATUS_LABEL[st]}</option>)}
                </select>
                {!u.postcode && <span className="text-xs text-gray-500">(no postcode — add it below)</span>}
                <button type="button" className="text-xs text-gray-500 underline" disabled={busy}
                  onClick={() => void run("Dismissed.", () => dismissUnmappedAction({ id: u.id }), () => setData((d) => ({ ...d, unmapped: d.unmapped.filter((x) => x.id !== u.id) })))}>Dismiss</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Check an address */}
      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-sm font-medium text-gray-900">Check an address</p>
        <p className="text-xs text-gray-500">What a customer at this suburb would be offered, as the list stands right now.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-sm"><span className="block text-xs text-gray-600">Suburb</span>
            <input className="rounded-md border border-gray-300 px-2 py-1 text-sm" value={check.suburb} data-testid="zone-check-suburb" onChange={(e) => setCheck((c) => ({ ...c, suburb: e.target.value }))} /></label>
          <label className="text-sm"><span className="block text-xs text-gray-600">Postcode</span>
            <input className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm" value={check.postcode} data-testid="zone-check-postcode" inputMode="numeric" onChange={(e) => setCheck((c) => ({ ...c, postcode: e.target.value }))} /></label>
          <button type="button" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" disabled={!check.suburb.trim()} onClick={() => void doCheck()} data-testid="zone-check-go">Check</button>
        </div>
        {checked && <p className="mt-2 text-sm text-gray-800" data-testid="zone-check-result">{checked}</p>}
      </div>

      {/* Suburb list */}
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => { setFilter(f.key); setPage(0); }} data-testid={`zone-filter-${f.key}`}
              className={`rounded-full border px-2.5 py-1 text-xs ${filter === f.key ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
              {f.label} <span className="opacity-70">{f.key === "all" ? data.suburbs.length : counts[f.key] ?? 0}</span>
            </button>
          ))}
          <input className="ml-auto w-48 rounded-md border border-gray-300 px-2 py-1 text-sm" placeholder="Find a suburb or postcode" value={q} data-testid="zone-search"
            onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-gray-500">{shown.length} shown{selected.size ? `, ${selected.size} selected` : ""}</span>
          <select className="rounded-md border border-gray-300 px-2 py-1 text-xs" defaultValue="" disabled={busy || !selected.size} data-testid="zone-move-selected"
            onChange={(e) => { if (e.target.value) { void moveSelected(e.target.value as ZoneStatus); e.target.value = ""; } }}>
            <option value="">Move selected to…</option>
            {ZONE_STATUSES.map((st) => <option key={st} value={st}>{ZONE_STATUS_LABEL[st]}</option>)}
          </select>
          <button type="button" className="rounded-md border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50 disabled:opacity-50" disabled={busy} onClick={() => void approveShown()} data-testid="zone-approve-shown">
            Approve everything shown
          </button>
        </div>

        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="w-6 py-1"><input type="checkbox" aria-label="Select all shown on this page" checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))}
                onChange={(e) => setSelected((s) => { const n = new Set(s); for (const r of pageRows) { if (e.target.checked) n.add(r.id); else n.delete(r.id); } return n; })} /></th>
              <th className="py-1">Suburb</th><th className="py-1">Postcode</th><th className="py-1">Status</th><th className="py-1">Far edge</th><th className="py-1">Reviewed</th><th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((s) => (
              <tr key={s.id} className="border-t border-gray-100" data-testid={`suburb-${s.suburb.replace(/\s+/g, "-").toLowerCase()}-${s.postcode}`}>
                <td className="py-1"><input type="checkbox" aria-label={`Select ${s.suburb}`} checked={selected.has(s.id)} onChange={(e) => setSelected((sel) => { const n = new Set(sel); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} /></td>
                <td className="py-1 font-medium text-gray-900">{s.suburb}</td>
                <td className="py-1 text-gray-600">{s.postcode}</td>
                <td className="py-1">
                  <select className={`rounded px-1.5 py-0.5 text-xs font-medium ${chip[s.status]}`} value={s.status} disabled={busy} data-testid="suburb-status"
                    onChange={(e) => void moveOne(s, e.target.value as ZoneStatus)}>
                    {ZONE_STATUSES.map((st) => <option key={st} value={st}>{ZONE_STATUS_LABEL[st]}</option>)}
                  </select>
                </td>
                <td className="py-1"><input type="checkbox" aria-label={`${s.suburb} far edge`} checked={s.far_edge} disabled={busy} data-testid="suburb-far-edge"
                  onChange={(e) => void run(`${s.suburb} ${e.target.checked ? "is" : "is no longer"} a far-edge suburb.`, () => setSuburbFarEdgeAction({ id: s.id, farEdge: e.target.checked }), () => patchRows([s.id], { far_edge: e.target.checked, reviewed: true }))} /></td>
                <td className="py-1 text-xs">{s.reviewed ? <span className="text-emerald-700">Yes</span> : <span className="text-amber-700">Not yet</span>}</td>
                <td className="py-1 text-right"><button type="button" className="text-xs text-gray-400 hover:text-red-700" disabled={busy} aria-label={`Remove ${s.suburb}`}
                  onClick={() => void run(`Removed ${s.suburb} ${s.postcode}.`, () => removeSuburbAction({ id: s.id }), () => setData((d) => ({ ...d, suburbs: d.suburbs.filter((x) => x.id !== s.id) })))}>Remove</button></td>
              </tr>
            ))}
            {!pageRows.length && !data.loadError && <tr><td colSpan={7} className="py-3 text-center text-xs text-gray-500">No suburbs match.</td></tr>}
          </tbody>
        </table>
        {shown.length > PAGE && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <button type="button" className="rounded border border-gray-300 px-2 py-0.5 disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="text-gray-500">{page * PAGE + 1}–{Math.min(shown.length, (page + 1) * PAGE)} of {shown.length}</span>
            <button type="button" className="rounded border border-gray-300 px-2 py-0.5 disabled:opacity-40" disabled={(page + 1) * PAGE >= shown.length} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </div>

      {/* Add */}
      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-sm font-medium text-gray-900">Add a suburb</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-sm"><span className="block text-xs text-gray-600">Suburb</span>
            <input className="rounded-md border border-gray-300 px-2 py-1 text-sm" value={add.suburb} data-testid="zone-add-suburb" onChange={(e) => setAdd((a) => ({ ...a, suburb: e.target.value }))} /></label>
          <label className="text-sm"><span className="block text-xs text-gray-600">Postcode</span>
            <input className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm" value={add.postcode} data-testid="zone-add-postcode" inputMode="numeric" maxLength={4} onChange={(e) => setAdd((a) => ({ ...a, postcode: e.target.value.replace(/\D/g, "") }))} /></label>
          <label className="text-sm"><span className="block text-xs text-gray-600">Status</span>
            <select className="rounded-md border border-gray-300 px-2 py-1 text-sm" value={add.status} data-testid="zone-add-status" onChange={(e) => setAdd((a) => ({ ...a, status: e.target.value as ZoneStatus }))}>
              {ZONE_STATUSES.map((st) => <option key={st} value={st}>{ZONE_STATUS_LABEL[st]}</option>)}
            </select></label>
          <label className="flex items-center gap-1 text-xs text-gray-700"><input type="checkbox" checked={add.farEdge} onChange={(e) => setAdd((a) => ({ ...a, farEdge: e.target.checked }))} /> Far edge</label>
          <button type="button" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" disabled={busy || !add.suburb.trim() || !/^\d{4}$/.test(add.postcode)} onClick={() => void addOne()} data-testid="zone-add-go">Add</button>
        </div>
      </div>

      {msg && <p className="text-sm text-gray-700" data-testid="visit-zones-msg">{msg}</p>}
    </div>
  );
}
