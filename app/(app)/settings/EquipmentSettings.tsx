"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GEAR_ICONS, GEAR_LABELS } from "@/lib/movements/gearIcons";
import { EQUIPMENT_CATEGORIES, EQUIPMENT_STATUSES, type EquipmentCategory, type EquipmentStatus } from "@/lib/movements/types";
import { createEquipmentItem, setEquipmentItemStatus, updateEquipmentItem } from "@/app/pc/movements/actions";

export type EquipmentRow = { id: string; tag: string; name: string; category: EquipmentCategory; serial_or_model: string; notes: string; status: EquipmentStatus };

const field = "rounded border border-gray-300 px-2 py-1 text-sm";

/**
 * Settings → Equipment (brief §3.1, rulings 1 and 18): the register. Two identical ladders
 * are two rows; the tag is given on save (E-###) unless typed; every category has an icon,
 * and a new category needs one before it can exist (the enum is the list). Location is
 * not here — it is derived from the ticked movements (Gear view).
 */
export default function EquipmentSettings({ initial }: { initial: EquipmentRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState<{ name: string; category: EquipmentCategory; serialOrModel: string; tag: string; notes: string }>({ name: "", category: "step_ladder", serialOrModel: "", tag: "", notes: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ name: string; category: EquipmentCategory; serialOrModel: string; notes: string }>({ name: "", category: "other", serialOrModel: "", notes: "" });

  const add = () => start(async () => {
    setMsg("");
    const r = await createEquipmentItem({ name: draft.name.trim(), category: draft.category, serialOrModel: draft.serialOrModel.trim(), tag: draft.tag.trim() || undefined, notes: draft.notes.trim() });
    setMsg(r.ok ? `Added as ${r.value.startsWith("E-") ? r.value : "a new item"}.` : r.message);
    if (r.ok) { setDraft({ name: "", category: draft.category, serialOrModel: "", tag: "", notes: "" }); router.refresh(); }
  });
  const save = (id: string) => start(async () => {
    setMsg("");
    const r = await updateEquipmentItem({ id, name: edit.name.trim(), category: edit.category, serialOrModel: edit.serialOrModel.trim(), notes: edit.notes.trim() });
    setMsg(r.ok ? "Saved." : r.message);
    if (r.ok) { setEditing(null); router.refresh(); }
  });
  const status = (id: string, s: EquipmentStatus) => start(async () => {
    setMsg("");
    const r = await setEquipmentItemStatus({ id, status: s });
    setMsg(r.ok ? `Now ${s}.` : r.message);
    if (r.ok) router.refresh();
  });

  return (
    <div className="space-y-4" data-testid="equipment-settings">
      <p className="text-xs text-gray-500">Where an item is now is on PC Command → Movements → Gear, from the last ticked movement that carried it. Retired items keep their trail.</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto] items-end rounded-md border border-gray-200 p-3" data-testid="equipment-add">
        <label className="text-sm"><span className="text-gray-700">Name</span><input className={`${field} w-full`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Extension ladder 7 m" data-testid="eq-name" /></label>
        <label className="text-sm"><span className="text-gray-700">Type</span><select className={field} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as EquipmentCategory })} data-testid="eq-category">{EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{GEAR_LABELS[c]}</option>)}</select></label>
        <label className="text-sm"><span className="text-gray-700">Serial / model</span><input className={field} value={draft.serialOrModel} onChange={(e) => setDraft({ ...draft, serialOrModel: e.target.value })} data-testid="eq-serial" /></label>
        <label className="text-sm"><span className="text-gray-700">Tag (blank = next E-###)</span><input className={`${field} w-24`} value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} data-testid="eq-tag" /></label>
        <button type="button" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40" disabled={pending || !draft.name.trim()} onClick={add} data-testid="eq-add">Add item</button>
      </div>
      {msg && <p className="text-sm text-gray-600" data-testid="eq-msg">{msg}</p>}
      <div className="divide-y divide-gray-200 rounded-md border border-gray-200" data-testid="equipment-list">
        {initial.length === 0 && <p className="p-3 text-sm text-gray-500">No items yet. Tom&rsquo;s real list replaces the template (⚑12); the seed refuses without EQUIPMENT_SEED_CONFIRMED=1.</p>}
        {initial.map((it) => (
          <div key={it.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-testid={`eq-row-${it.tag}`} data-status={it.status}>
            <span className="inline-flex h-7 w-7 items-center justify-center text-violet-700 [&>svg]:h-5 [&>svg]:w-5">{GEAR_ICONS[it.category] ?? GEAR_ICONS.other}</span>
            <span className="font-mono text-xs text-cyan-700">{it.tag}</span>
            {editing === it.id ? (
              <>
                <input className={field} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="eq-edit-name" />
                <select className={field} value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as EquipmentCategory })}>{EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{GEAR_LABELS[c]}</option>)}</select>
                <input className={field} value={edit.serialOrModel} onChange={(e) => setEdit({ ...edit, serialOrModel: e.target.value })} placeholder="serial / model" />
                <input className={`${field} flex-1`} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="notes" />
                <button type="button" className="rounded-md bg-gray-900 px-2 py-1 text-xs text-white" disabled={pending} onClick={() => save(it.id)} data-testid="eq-edit-save">Save</button>
                <button type="button" className="text-xs text-gray-500" onClick={() => setEditing(null)}>Cancel</button>
              </>
            ) : (
              <>
                <span className="font-medium">{it.name}</span>
                <span className="text-xs text-gray-500">{GEAR_LABELS[it.category]}{it.serial_or_model ? ` · ${it.serial_or_model}` : ""}{it.notes ? ` · ${it.notes}` : ""}</span>
                <span className="ml-auto flex items-center gap-2">
                  <select className={field} value={it.status} onChange={(e) => status(it.id, e.target.value as EquipmentStatus)} data-testid={`eq-status-${it.tag}`}>{EQUIPMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                  <button type="button" className="text-xs text-gray-600 underline" onClick={() => { setEditing(it.id); setEdit({ name: it.name, category: it.category, serialOrModel: it.serial_or_model, notes: it.notes }); }} data-testid={`eq-edit-${it.tag}`}>Edit</button>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
