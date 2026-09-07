"use client";

import { useState } from "react";
import type { StaffAvailability, VisitsSettings } from "@/lib/visits/types";
import { saveStaffAvailabilityAction, saveVisitsSettingsAction } from "./visitsSettingsActions";

/**
 * Settings → Estimator visits (P6): who takes visits and when, plus the global
 * numbers the wizard's slot list uses. No deploy for any of it.
 */
const DAYS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]] as const;

export default function VisitsSettingsPanel({ initial, staff: initialStaff }: { initial: VisitsSettings; staff: StaffAvailability[] }) {
  const [form, setForm] = useState<VisitsSettings>(initial);
  const [staff, setStaff] = useState<StaffAvailability[]>(initialStaff);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const num = (key: "horizonDays" | "cutoffHours" | "reminderHour", label: string, unit: string) => (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input type="number" className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={form[key]} data-testid={`visits-${key}`}
          onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) || 0 }))} />
        <span className="text-xs text-gray-500">{unit}</span>
      </div>
    </label>
  );
  const win = (part: "am" | "pm", label: string) => (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input type="time" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={form.windows[part][0]}
          onChange={(e) => setForm((f) => ({ ...f, windows: { ...f.windows, [part]: [e.target.value, f.windows[part][1]] } }))} />
        <span className="text-xs text-gray-500">to</span>
        <input type="time" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={form.windows[part][1]}
          onChange={(e) => setForm((f) => ({ ...f, windows: { ...f.windows, [part]: [f.windows[part][0], e.target.value] } }))} />
      </div>
    </label>
  );

  async function saveGlobal() {
    setSaving("global"); setMsg("");
    const r = await saveVisitsSettingsAction(form);
    setSaving(null); setMsg(r.ok ? "Saved. The wizard offers the new windows from its next load." : r.message);
  }
  async function saveRow(row: StaffAvailability) {
    setSaving(row.staffId); setMsg("");
    const r = await saveStaffAvailabilityAction(row);
    setSaving(null); setMsg(r.ok ? `Saved ${row.name}.` : r.message);
  }
  const patch = (id: string, next: Partial<StaffAvailability>) => setStaff((rows) => rows.map((r) => (r.staffId === id ? { ...r, ...next } : r)));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-gray-900">Windows the customer can pick online</p>
        <p className="text-xs text-gray-500">Morning or afternoon, never an exact time — visits cluster and the estimator keeps the order of the day. One Melbourne zone until the zone map is ruled.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {win("am", "Morning window")}
          {win("pm", "Afternoon window")}
          {num("horizonDays", "Offer the next", "business days")}
          {num("cutoffHours", "Nothing closer than", "hours ahead")}
          {num("reminderHour", "Reminder text goes at", "o'clock, the evening before")}
        </div>
        <button className="mt-3 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" disabled={saving === "global"} onClick={saveGlobal} data-testid="visits-save">
          {saving === "global" ? "Saving…" : "Save"}
        </button>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900">Who takes visits</p>
        <p className="text-xs text-gray-500">Tick the estimators, their days and hours. The visit length is what a window has to have free before it is offered.</p>
        <div className="mt-3 space-y-3">
          {staff.map((row) => (
            <div key={row.staffId} className="rounded-md border border-gray-200 p-3" data-testid={`avail-${row.staffId}`}>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  <input type="checkbox" checked={row.takesVisits} onChange={(e) => patch(row.staffId, { takesVisits: e.target.checked })} data-testid={`avail-${row.staffId}-takes`} />
                  {row.name}
                </label>
                <div className="flex flex-wrap gap-1">
                  {DAYS.map(([label, dow]) => (
                    <button key={dow} type="button"
                      className={`rounded-full border px-2 py-0.5 text-xs ${row.days.includes(dow) ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-600"}`}
                      onClick={() => patch(row.staffId, { days: row.days.includes(dow) ? row.days.filter((d) => d !== dow) : [...row.days, dow].sort() })}>
                      {label}
                    </button>
                  ))}
                </div>
                <input type="time" className="rounded-md border border-gray-300 px-2 py-1 text-sm" value={row.dayStart} onChange={(e) => patch(row.staffId, { dayStart: e.target.value })} aria-label="Day starts" />
                <span className="text-xs text-gray-500">to</span>
                <input type="time" className="rounded-md border border-gray-300 px-2 py-1 text-sm" value={row.dayEnd} onChange={(e) => patch(row.staffId, { dayEnd: e.target.value })} aria-label="Day ends" />
                <input type="number" className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm" value={row.visitMinutes} onChange={(e) => patch(row.staffId, { visitMinutes: Number(e.target.value) || 60 })} aria-label="Visit minutes" />
                <span className="text-xs text-gray-500">min per visit</span>
                <button className="rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" disabled={saving === row.staffId} onClick={() => saveRow(row)} data-testid={`avail-${row.staffId}-save`}>
                  {saving === row.staffId ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ))}
          {staff.length === 0 && <p className="text-sm text-gray-500">No staff logins yet — add them under Staff logins first.</p>}
        </div>
      </div>
      {msg && <p className="text-sm text-gray-700" data-testid="visits-msg">{msg}</p>}
    </div>
  );
}
