"use client";

import { useMemo, useState } from "react";
import { WEEKDAY_SHORT, minutesToTime, slotsPerZone, timeToMinutes, type BookingRules, type SlotCond, type WeekSlot } from "@/lib/visits/schedule";
import type { ScheduleEstimator } from "@/lib/visits/scheduleDb";
import { ZONE_KEYS, ZONE_STATUS_LABEL, type ZoneKey } from "@/lib/visits/zones";
import { loadStandardWeekAction, removeSlotAction, saveSlotAction } from "./visitScheduleActions";

/**
 * Settings → Visit schedule (addendum A §6, mockup "Your week" tab). Per
 * estimator: day tabs, each slot with its time and zone chips; tap a slot to
 * toggle zones, set the conditional rule, or remove it; add a slot; a live
 * count of slots a week per zone; a clear warning on a slot nobody can book.
 */

type Slot = WeekSlot & { id: string };
const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const zoneNum = (z: ZoneKey) => z.replace("zone_", "");
const chip: Record<ZoneKey, string> = {
  zone_1: "bg-emerald-100 text-emerald-800", zone_2: "bg-sky-100 text-sky-800", zone_3: "bg-violet-100 text-violet-800",
  zone_4: "bg-amber-100 text-amber-800", zone_5: "bg-rose-100 text-rose-800",
};

export default function VisitScheduleSettings({ estimators: initial, rules, loadError }: { estimators: ScheduleEstimator[]; rules: BookingRules; loadError: string | null }) {
  const [estimators, setEstimators] = useState(initial);
  const [estId, setEstId] = useState(initial.find((e) => e.slots.length)?.id ?? initial[0]?.id ?? "");
  const [weekday, setWeekday] = useState<number>(1);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [newTime, setNewTime] = useState("");

  const est = estimators.find((e) => e.id === estId) ?? null;
  const daySlots = useMemo(() => (est?.slots ?? []).filter((s) => s.weekday === weekday).sort((a, b) => a.startMinutes - b.startMinutes), [est, weekday]);
  const totals = useMemo(() => slotsPerZone(est?.slots ?? []), [est]);
  const lastEnd = daySlots.length ? daySlots[daySlots.length - 1].startMinutes + daySlots[daySlots.length - 1].lengthMinutes : 8 * 60;

  const patchEst = (fn: (e: ScheduleEstimator) => ScheduleEstimator) => setEstimators((list) => list.map((e) => (e.id === estId ? fn(e) : e)));

  async function save(slot: Omit<Slot, "id"> & { id?: string }, label: string): Promise<boolean> {
    if (!est) return false;
    setBusy(true); setMsg("");
    const r = await saveSlotAction({ id: slot.id, estimatorId: est.id, weekday: slot.weekday, startMinutes: slot.startMinutes, zones: slot.zones, cond: slot.cond });
    setBusy(false);
    if (!r.ok) { setMsg(r.message); return false; }
    const saved: Slot = { ...slot, id: r.id ?? slot.id ?? "", lengthMinutes: rules.slotMinutes };
    patchEst((e) => ({ ...e, slots: slot.id ? e.slots.map((s) => (s.id === slot.id ? saved : s)) : [...e.slots, saved] }));
    setMsg(label);
    return true;
  }
  async function toggleZone(slot: Slot, z: ZoneKey) {
    const zones = slot.zones.includes(z) ? slot.zones.filter((x) => x !== z) : [...slot.zones, z].sort();
    await save({ ...slot, zones }, `${WEEKDAY_SHORT[slot.weekday]} ${minutesToTime(slot.startMinutes)}: ${zones.length ? zones.map(ZONE_STATUS_LABEL_SHORT).join(", ") : "no zones — nobody can book it"}.`);
  }
  async function setCond(slot: Slot, cond: SlotCond | null) {
    await save({ ...slot, cond }, cond ? `${WEEKDAY_SHORT[slot.weekday]} ${minutesToTime(slot.startMinutes)} also takes ${ZONE_STATUS_LABEL[cond.zone]} after a ${ZONE_STATUS_LABEL[cond.ifPrevZone]} visit.` : "Conditional rule cleared.");
  }
  async function remove(slot: Slot) {
    setBusy(true); setMsg("");
    const r = await removeSlotAction({ id: slot.id });
    setBusy(false);
    if (!r.ok) { setMsg(r.message); return; }
    patchEst((e) => ({ ...e, slots: e.slots.filter((s) => s.id !== slot.id) }));
    setOpen(null);
    setMsg(`Removed ${WEEKDAY_SHORT[slot.weekday]} ${minutesToTime(slot.startMinutes)}.`);
  }
  async function addSlot() {
    const start = newTime ? timeToMinutes(newTime) : lastEnd;
    if (!Number.isFinite(start)) { setMsg("Type a time like 08:00."); return; }
    const ok = await save({ weekday, startMinutes: start, lengthMinutes: rules.slotMinutes, zones: [], cond: null }, `Added ${WEEKDAY_SHORT[weekday]} ${minutesToTime(start)}. Tick the zones that can book it.`);
    if (ok) setNewTime("");
  }
  async function loadStandard() {
    if (!est) return;
    setBusy(true); setMsg("");
    const r = await loadStandardWeekAction({ estimatorId: est.id });
    setBusy(false);
    if (!r.ok) { setMsg(r.message); return; }
    // The server made the rows; reload the page's data rather than guessing ids.
    window.location.reload();
  }

  return (
    <div className="space-y-5" data-testid="visit-schedule">
      {loadError && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="visit-schedule-load-error">{loadError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-900">Estimator</span>
        {estimators.map((e) => (
          <button key={e.id} type="button" onClick={() => { setEstId(e.id); setOpen(null); }} data-testid={`sched-est-${e.id}`}
            className={`rounded-full border px-2.5 py-1 text-xs ${e.id === estId ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
            {e.name}{e.zones.length ? ` · zones ${e.zones.map(zoneNum).join(", ")}` : ""}
          </button>
        ))}
      </div>

      {est && !est.slots.length && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="sched-empty">
          <p className="text-amber-900">{est.name} has no week yet, so customers in {est.zones.length ? `zone${est.zones.length === 1 ? "" : "s"} ${est.zones.map(zoneNum).join(", ")}` : "their zones"} see no times.</p>
          <button type="button" className="mt-2 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" disabled={busy} onClick={() => void loadStandard()} data-testid="sched-load-standard">
            Load the standard week (21 slots)
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Day">
        {DAYS.map((d) => {
          const n = (est?.slots ?? []).filter((s) => s.weekday === d).length;
          return (
            <button key={d} type="button" role="tab" aria-selected={d === weekday} onClick={() => { setWeekday(d); setOpen(null); }} data-testid={`sched-day-${d}`}
              className={`rounded-md border px-2.5 py-1 text-sm ${d === weekday ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
              {WEEKDAY_SHORT[d]} <span className="opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2" data-testid="sched-slots">
        {daySlots.map((s) => (
          <div key={s.id} className="rounded-md border border-gray-200" data-testid={`slot-${s.weekday}-${s.startMinutes}`}>
            <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
              <span className="font-mono text-sm text-gray-900">{minutesToTime(s.startMinutes)} to {minutesToTime(s.startMinutes + s.lengthMinutes)}</span>
              <span className="flex flex-wrap items-center gap-1" data-testid="slot-zones">
                {s.zones.length
                  ? s.zones.map((z) => <span key={z} className={`rounded px-1.5 py-0.5 text-xs font-medium ${chip[z]}`}>{zoneNum(z)}</span>)
                  : <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800" data-testid="slot-no-zones">No zones — nobody can book this</span>}
                {s.cond && <span className="text-xs text-gray-500">+ Zone {zoneNum(s.cond.zone)} if the visit before is Zone {zoneNum(s.cond.ifPrevZone)}</span>}
              </span>
            </button>
            {open === s.id && (
              <div className="border-t border-gray-100 px-3 py-2">
                <p className="text-xs text-gray-600">Zones that can book this slot</p>
                <div className="mt-1 flex gap-1">
                  {ZONE_KEYS.map((z) => (
                    <button key={z} type="button" aria-pressed={s.zones.includes(z)} aria-label={ZONE_STATUS_LABEL[z]} disabled={busy} onClick={() => void toggleZone(s, z)} data-testid={`slot-zone-${zoneNum(z)}`}
                      className={`h-8 w-8 rounded-md border text-sm font-medium ${s.zones.includes(z) ? `${chip[z]} border-transparent` : "border-gray-300 text-gray-400"}`}>{zoneNum(z)}</button>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-700">
                  <span>Also</span>
                  <select className="rounded-md border border-gray-300 px-1.5 py-0.5" value={s.cond?.zone ?? ""} disabled={busy} data-testid="slot-cond-zone"
                    onChange={(e) => void setCond(s, e.target.value ? { zone: e.target.value as ZoneKey, ifPrevZone: s.cond?.ifPrevZone ?? (e.target.value as ZoneKey) } : null)}>
                    <option value="">no other zone</option>
                    {ZONE_KEYS.map((z) => <option key={z} value={z}>{ZONE_STATUS_LABEL[z]}</option>)}
                  </select>
                  {s.cond && (<>
                    <span>if the slot before is</span>
                    <select className="rounded-md border border-gray-300 px-1.5 py-0.5" value={s.cond.ifPrevZone} disabled={busy} data-testid="slot-cond-prev"
                      onChange={(e) => void setCond(s, { zone: s.cond!.zone, ifPrevZone: e.target.value as ZoneKey })}>
                      {ZONE_KEYS.map((z) => <option key={z} value={z}>{ZONE_STATUS_LABEL[z]}</option>)}
                    </select>
                  </>)}
                </div>
                <button type="button" className="mt-3 text-xs text-red-700 underline disabled:opacity-50" disabled={busy} onClick={() => void remove(s)} data-testid="slot-remove">Remove this slot</button>
              </div>
            )}
          </div>
        ))}
        {!daySlots.length && est && <p className="text-sm text-gray-500" data-testid="sched-no-slots">No slots on this day.</p>}
      </div>

      {est && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm"><span className="block text-xs text-gray-600">Start time</span>
            <input className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm" placeholder={minutesToTime(lastEnd)} value={newTime} data-testid="sched-add-time" onChange={(e) => setNewTime(e.target.value)} /></label>
          <button type="button" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" disabled={busy || lastEnd + rules.slotMinutes > 24 * 60 && !newTime} onClick={() => void addSlot()} data-testid="sched-add">
            Add a slot{!newTime ? ` at ${minutesToTime(lastEnd)}` : ""}
          </button>
          <span className="text-xs text-gray-500">Each slot runs {rules.slotMinutes} minutes: {rules.visitMinutes} with the customer, then travel.</span>
        </div>
      )}

      <div>
        <p className="text-sm font-medium text-gray-900">Slots a week each zone can book</p>
        <p className="text-xs text-gray-500">A slot shared between zones is counted for each zone, so it goes to whichever customer books first. Conditional rules are not counted.</p>
        <div className="mt-2 flex flex-wrap gap-3" data-testid="sched-totals">
          {ZONE_KEYS.map((z) => (
            <div key={z} className="flex items-center gap-1.5 text-sm" data-testid={`sched-total-${zoneNum(z)}`}>
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${chip[z]}`}>{zoneNum(z)}</span>
              <b data-testid="total-n">{totals[z]}</b><span className="text-xs text-gray-500">a week</span>
            </div>
          ))}
        </div>
      </div>

      {msg && <p className="text-sm text-gray-700" data-testid="visit-schedule-msg">{msg}</p>}
    </div>
  );
}

function ZONE_STATUS_LABEL_SHORT(z: ZoneKey) { return ZONE_STATUS_LABEL[z]; }
