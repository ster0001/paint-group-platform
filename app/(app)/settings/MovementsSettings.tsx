"use client";

import { useState } from "react";
import type { BoardPerson, MovementsSettings as Settings } from "@/lib/movements/types";
import { LANE_PALETTE } from "@/lib/movements/evaluate";
import { saveMovementsSettingsAction } from "./movementsSettingsActions";

export type StaffOption = { id: string; name: string };

const field = "w-full rounded border border-gray-300 px-2 py-1 text-sm";

/**
 * Settings → Movements (Session 6): the row every Movements screen reads. Board people
 * are staff profiles; each gets AM/PM or one-hour slots (ruling 16) and a colour that
 * labels their movements everywhere. The map key is checked here too (⚑4).
 */
export default function MovementsSettings({ initial, staff, mapsKeyPresent }: { initial: Settings; staff: StaffOption[]; mapsKeyPresent: boolean }) {
  const [form, setForm] = useState<Settings>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (patch: Partial<Settings>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const people = form.boardPeople;
  const setPeople = (next: BoardPerson[]) => set({ boardPeople: next });
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? "(not a staff login)";
  const free = staff.filter((s) => !people.some((p) => p.id === s.id));

  async function save() {
    setSaving(true); setMsg("");
    const r = await saveMovementsSettingsAction(form);
    setSaving(false);
    setMsg(r.ok ? "Saved. The board reads these on its next load." : r.message);
    if (r.ok) setDirty(false);
  }

  return (
    <div className="space-y-6" data-testid="movements-settings">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Warehouse</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm"><span className="text-gray-700">Label</span><input className={field} value={form.warehouse.label} onChange={(e) => set({ warehouse: { ...form.warehouse, label: e.target.value } })} data-testid="mv-wh-label" /></label>
          <label className="text-sm"><span className="text-gray-700">Address</span><input className={field} value={form.warehouse.address} onChange={(e) => set({ warehouse: { ...form.warehouse, address: e.target.value } })} data-testid="mv-wh-address" /></label>
          <label className="text-sm"><span className="text-gray-700">Suburb</span><input className={field} value={form.warehouse.suburb} onChange={(e) => set({ warehouse: { ...form.warehouse, suburb: e.target.value } })} data-testid="mv-wh-suburb" /></label>
          <label className="text-sm"><span className="text-gray-700">Postcode</span><input className={field} value={form.warehouse.postcode} onChange={(e) => set({ warehouse: { ...form.warehouse, postcode: e.target.value } })} data-testid="mv-wh-postcode" /></label>
          <label className="text-sm"><span className="text-gray-700">Latitude (optional — the suburb centroid otherwise)</span><input className={field} type="number" step="0.00001" value={form.warehouse.lat ?? ""} onChange={(e) => set({ warehouse: { ...form.warehouse, lat: e.target.value === "" ? null : Number(e.target.value) } })} data-testid="mv-wh-lat" /></label>
          <label className="text-sm"><span className="text-gray-700">Longitude</span><input className={field} type="number" step="0.00001" value={form.warehouse.lng ?? ""} onChange={(e) => set({ warehouse: { ...form.warehouse, lng: e.target.value === "" ? null : Number(e.target.value) } })} data-testid="mv-wh-lng" /></label>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Rules</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm"><span>Nearby radius</span><span className="flex items-center gap-2"><input type="number" min={1} max={50} className="w-20 rounded border border-gray-300 px-2 py-1 text-right" value={form.nearKm} onChange={(e) => set({ nearKm: Number(e.target.value) })} data-testid="mv-nearkm" /><span className="w-10 text-xs text-gray-500">km</span></span></label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm"><span>Planning horizon (a job starting within this many days with tray chips is a work item)</span><span className="flex items-center gap-2"><input type="number" min={1} max={60} className="w-20 rounded border border-gray-300 px-2 py-1 text-right" value={form.planningHorizonDays} onChange={(e) => set({ planningHorizonDays: Number(e.target.value) })} data-testid="mv-horizon" /><span className="w-10 text-xs text-gray-500">days</span></span></label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm"><span>A delivery due today still only booked by</span><input type="time" className="rounded border border-gray-300 px-2 py-1" value={form.deliveryConfirmBy} onChange={(e) => set({ deliveryConfirmBy: e.target.value })} data-testid="mv-confirm-by" /></label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm"><span>Default times for AM / PM drops</span><span className="flex gap-2"><input type="time" className="rounded border border-gray-300 px-2 py-1" value={form.defaultHalfTime.AM} onChange={(e) => set({ defaultHalfTime: { ...form.defaultHalfTime, AM: e.target.value } })} data-testid="mv-am" /><input type="time" className="rounded border border-gray-300 px-2 py-1" value={form.defaultHalfTime.PM} onChange={(e) => set({ defaultHalfTime: { ...form.defaultHalfTime, PM: e.target.value } })} data-testid="mv-pm" /></span></label>
          <label className="flex items-center gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.recordHireCosts} onChange={(e) => set({ recordHireCosts: e.target.checked })} data-testid="mv-hire-costs" /><span>An off-hire ticked Done with an expected cost writes the hire cost to the job</span></label>
          <label className="flex items-center gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.showHowItWorks} onChange={(e) => set({ showHowItWorks: e.target.checked })} data-testid="mv-how" /><span>Show the &ldquo;How this tab works&rdquo; strip</span></label>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Board people — who gets a staff lane</h4>
        <p className="mb-2 text-xs text-gray-500">Each person&rsquo;s movements wear their colour on the board, in Day and on the map. Hourly lanes show ten one-hour rows from 07:30 (Felipe and Tom); everyone else is AM / PM. &ldquo;Checks on lane&rdquo; puts quality checks and site check-ins on that person&rsquo;s lane.</p>
        <div className="space-y-2" data-testid="mv-board-people">
          {people.map((p, i) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm" data-testid={`mv-person-${p.id}`}>
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: p.colour ?? LANE_PALETTE[i % LANE_PALETTE.length] }} />
              <span className="font-medium">{nameOf(p.id)}</span>
              <select className="rounded border border-gray-300 px-2 py-1" value={p.slots ?? "half"} onChange={(e) => setPeople(people.map((x) => (x.id === p.id ? { ...x, slots: e.target.value === "hour" ? "hour" : "half" } : x)))} data-testid={`mv-slots-${p.id}`}>
                <option value="half">AM / PM</option><option value="hour">1-hour slots</option>
              </select>
              <input type="color" value={p.colour ?? LANE_PALETTE[i % LANE_PALETTE.length]} onChange={(e) => setPeople(people.map((x) => (x.id === p.id ? { ...x, colour: e.target.value } : x)))} aria-label="Lane colour" data-testid={`mv-colour-${p.id}`} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={p.checks ?? false} onChange={(e) => setPeople(people.map((x) => (x.id === p.id ? { ...x, checks: e.target.checked } : x)))} /> checks on lane</label>
              <button type="button" className="ml-auto text-gray-400 hover:text-red-600" onClick={() => setPeople(people.filter((x) => x.id !== p.id))} aria-label={`Remove ${nameOf(p.id)}`}>×</button>
            </div>
          ))}
          {free.length > 0 && (
            <select className="rounded border border-gray-300 px-2 py-1 text-sm" value="" onChange={(e) => { if (e.target.value) setPeople([...people, { id: e.target.value, slots: "half", colour: LANE_PALETTE[people.length % LANE_PALETTE.length] }]); }} data-testid="mv-add-person">
              <option value="">Add a staff member…</option>
              {free.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="rounded-md border border-gray-200 px-3 py-2 text-sm" data-testid="mv-maps-key">
        <b>Google Maps browser key:</b> {mapsKeyPresent ? <span className="text-emerald-700">present — the Map view is on.</span> : <span className="text-amber-700">missing — set NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY (Maps JavaScript API, website-restricted) in Vercel and .env.local; the Map view stays off until then.</span>}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={!dirty || saving} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40" data-testid="mv-save">{saving ? "Saving…" : "Save Movements settings"}</button>
        {msg && <span className="text-sm text-gray-600" data-testid="mv-msg">{msg}</span>}
      </div>
    </div>
  );
}
