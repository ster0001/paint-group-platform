"use client";

import { useState } from "react";
import type { BookingRules } from "@/lib/visits/schedule";
import { ZONE_KEYS, ZONE_STATUS_LABEL, type ZoneKey } from "@/lib/visits/zones";
import { saveBookingRulesAction } from "./visitScheduleActions";

/**
 * Settings → Booking rules (addendum A §6): the numbers behind the calendar,
 * the phone limits, the reminder time, the public holidays, the far-edge
 * pairs and the gate order. One settings row; the availability function and
 * the booking action read it.
 */
export default function BookingRulesSettings({ initial }: { initial: BookingRules }) {
  const [f, setF] = useState<BookingRules>(initial);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [newHoliday, setNewHoliday] = useState("");

  const num = (key: keyof BookingRules, label: string, unit: string, opts: { step?: number; money?: boolean } = {}) => (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        {opts.money && <span className="text-xs text-gray-500">$</span>}
        <input type="number" step={opts.step ?? 1} className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm" data-testid={`rules-${key}`}
          value={opts.money ? Math.round(Number(f[key]) / 100) : Number(f[key])}
          onChange={(e) => setF((x) => ({ ...x, [key]: opts.money ? Math.round(Number(e.target.value) * 100) : Number(e.target.value) }))} />
        <span className="text-xs text-gray-500">{unit}</span>
      </div>
    </label>
  );

  async function save() {
    setSaving(true); setMsg("");
    const r = await saveBookingRulesAction(f);
    setSaving(false);
    setMsg(r.ok ? "Saved. The calendar uses these rules from its next load." : r.message);
  }
  const addHoliday = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newHoliday)) { setMsg("A holiday is a date like 2026-12-25."); return; }
    setF((x) => ({ ...x, publicHolidays: [...new Set([...x.publicHolidays, newHoliday])].sort() }));
    setNewHoliday("");
  };

  return (
    <div className="space-y-5" data-testid="booking-rules">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={f.sameDay} data-testid="rules-sameDay" onChange={(e) => setF((x) => ({ ...x, sameDay: e.target.checked }))} /> Customers can book a slot today
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700" title="Off only on a test project: customers book into an estimator's week with no Google Calendar behind it.">
          <input type="checkbox" checked={f.calendarRequired} data-testid="rules-calendarRequired" onChange={(e) => setF((x) => ({ ...x, calendarRequired: e.target.checked }))} /> Customers can only book when the estimator&rsquo;s Google Calendar is connected
        </label>
        {num("minNoticeMinutes", "Shortest notice", "minutes before the slot starts")}
        {num("windowDays", "How far ahead", "days")}
        {num("holdMinutes", "Hold a slot while the code is entered", "minutes")}
        {num("slotMinutes", "Slot length, visit plus travel", "minutes")}
        {num("visitMinutes", "Visit length the customer sees", "minutes")}
        {num("speakInteriorCapCents", "Speak with us, interior, up to", "AUD inc GST, top of the range", { money: true })}
        {num("speakExteriorCapCents", "Speak with us, straightforward exterior, up to", "AUD inc GST", { money: true })}
        <label className="block text-sm">
          <span className="text-gray-700">Reminder text, the day before</span>
          <div className="mt-1"><input type="time" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={f.reminderTime} data-testid="rules-reminderTime" onChange={(e) => setF((x) => ({ ...x, reminderTime: e.target.value }))} /></div>
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Gate order, switched by hand</span>
          <select className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={f.gateOrder} data-testid="rules-gateOrder" onChange={(e) => setF((x) => ({ ...x, gateOrder: e.target.value as BookingRules["gateOrder"] }))}>
            <option value="details_first">Details first, then the price range</option>
            <option value="range_first">Price range first, details after</option>
          </select>
        </label>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900">Far-edge pairs</p>
        <p className="text-xs text-gray-500">A far-edge visit in one zone of a pair is never back to back with a far-edge visit in the other.</p>
        <ul className="mt-2 space-y-1" data-testid="rules-far-pairs">
          {f.farEdgePairs.map(([a, b], i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span>{ZONE_STATUS_LABEL[a]} and {ZONE_STATUS_LABEL[b]}</span>
              <button type="button" className="text-xs text-gray-500 underline" onClick={() => setF((x) => ({ ...x, farEdgePairs: x.farEdgePairs.filter((_, j) => j !== i) }))}>Remove</button>
            </li>
          ))}
        </ul>
        <PairAdder onAdd={(p) => setF((x) => ({ ...x, farEdgePairs: [...x.farEdgePairs, p] }))} />
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900">Public holidays</p>
        <p className="text-xs text-gray-500">No slots are offered on these days and they do not count towards &ldquo;one working day&rdquo;. Melbourne dates.</p>
        <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="rules-holidays">
          {f.publicHolidays.map((d) => (
            <li key={d} className="flex items-center gap-1 rounded-full border border-gray-300 px-2 py-0.5 text-xs">
              {d}<button type="button" aria-label={`Remove ${d}`} className="text-gray-400 hover:text-red-700" onClick={() => setF((x) => ({ ...x, publicHolidays: x.publicHolidays.filter((h) => h !== d) }))}>×</button>
            </li>
          ))}
          {!f.publicHolidays.length && <li className="text-xs text-amber-700">None yet.</li>}
        </ul>
        <div className="mt-2 flex items-center gap-2">
          <input type="date" className="rounded-md border border-gray-300 px-2 py-1 text-sm" value={newHoliday} data-testid="rules-holiday-new" onChange={(e) => setNewHoliday(e.target.value)} />
          <button type="button" className="rounded-md border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50" onClick={addHoliday} data-testid="rules-holiday-add">Add</button>
        </div>
      </div>

      <button className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" disabled={saving} onClick={() => void save()} data-testid="rules-save">
        {saving ? "Saving…" : "Save booking rules"}
      </button>
      {msg && <p className="text-sm text-gray-700" data-testid="rules-msg">{msg}</p>}
    </div>
  );
}

function PairAdder({ onAdd }: { onAdd: (p: [ZoneKey, ZoneKey]) => void }) {
  const [a, setA] = useState<ZoneKey>("zone_4");
  const [b, setB] = useState<ZoneKey>("zone_3");
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <select className="rounded-md border border-gray-300 px-1.5 py-0.5" value={a} onChange={(e) => setA(e.target.value as ZoneKey)}>{ZONE_KEYS.map((z) => <option key={z} value={z}>{ZONE_STATUS_LABEL[z]}</option>)}</select>
      <span>and</span>
      <select className="rounded-md border border-gray-300 px-1.5 py-0.5" value={b} onChange={(e) => setB(e.target.value as ZoneKey)}>{ZONE_KEYS.map((z) => <option key={z} value={z}>{ZONE_STATUS_LABEL[z]}</option>)}</select>
      <button type="button" className="rounded-md border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-50" disabled={a === b} onClick={() => onAdd([a, b])}>Add pair</button>
    </div>
  );
}
