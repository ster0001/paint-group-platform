"use client";

import { useMemo, useState } from "react";
import { kindLabel, locations, shortDay, type ItemLocationView, type MovementLane, type World } from "@/lib/movements/evaluate";
import { GEAR_ICONS, GEAR_LABELS } from "@/lib/movements/gearIcons";
import type { EquipmentCategory, MovementRow } from "@/lib/movements/types";

type Filter = "all" | "wh" | "out" | "painter" | "flag";
const FILTERS: [Filter, string][] = [["all", "All"], ["wh", "At warehouse"], ["out", "Out on site"], ["painter", "With a painter"], ["flag", "Flagged"]];

type Pill = { cls: "wh" | "site" | "painter" | "repair" | "flag" | "other"; label: string };
function pillOf(v: ItemLocationView): Pill {
  switch (v.state) {
    case "warehouse": return { cls: "wh", label: "Warehouse" };
    case "site": return { cls: "site", label: v.next && v.next.status !== "tray" ? "On site · return booked" : "On site" };
    case "stranded": return { cls: "flag", label: "On site · job closed" };
    case "person": return { cls: "painter", label: "With painter" };
    case "repair": return { cls: "repair", label: "Repair" };
    default: return { cls: "other", label: "Elsewhere" };
  }
}
const matches = (f: Filter, p: Pill) => f === "all" || (f === "wh" && p.cls === "wh") || (f === "out" && (p.cls === "site" || p.cls === "flag")) || (f === "painter" && p.cls === "painter") || (f === "flag" && p.cls === "flag");

/**
 * Gear (brief §3.4, ruling 18): the register, each item with its type icon, tag, where it
 * is now (the last ticked movement that carried it — never typed) and what carries it
 * next; tap for the trail. Everything here is `locations()` over the world; a stranded
 * item's "Find it in the tray" opens its return chip on the Week board.
 */
export default function GearView({ world, lanes, onFindInTray }: { world: World; lanes: MovementLane[]; onFindInTray: (m: MovementRow) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const laneNames = useMemo(() => new Map(lanes.map((l) => [l.id, l.name])), [lanes]);
  const views = useMemo(() => locations(world, laneNames).map((v) => ({ v, pill: pillOf(v) })).sort((a, b) => (a.pill.cls === "flag" ? 0 : 1) - (b.pill.cls === "flag" ? 0 : 1) || a.v.item.tag.localeCompare(b.v.item.tag)), [world, laneNames]);
  const shown = views.filter((x) => matches(filter, x.pill));
  const count = (f: Filter) => views.filter((x) => matches(f, x.pill)).length;
  const carried = (itemId: string) => world.movements.filter((m) => m.items.some((i) => i.equipment_item_id === itemId) && m.status !== "cancelled")
    .sort((a, b) => (a.done_at ?? a.due_date ?? "9999").localeCompare(b.done_at ?? b.due_date ?? "9999"));
  const whoOf = (m: MovementRow) => (m.assignee_kind === "supplier" ? "supplier" : laneNames.get(m.assignee_id ?? "") ?? "—");

  return (
    <div className="gearview" data-testid="gear-view">
      <div className="gearhead">
        <div className="filters" data-testid="gear-filters" style={{ margin: 0 }}>
          {FILTERS.map(([k, l]) => <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)} data-filter={k}>{l} {count(k)}</button>)}
        </div>
      </div>
      <div className="gearlegend" data-testid="gear-legend">
        {(Object.keys(GEAR_ICONS) as EquipmentCategory[]).filter((k) => k !== "other").map((k) => <span key={k}>{GEAR_ICONS[k]}{GEAR_LABELS[k]}</span>)}
      </div>
      {views.length === 0 && <p className="note">No items in the register yet — add them in Settings → Equipment.</p>}
      <div className="geargrid" data-testid="gear-grid">
        {shown.map(({ v, pill }) => {
          const isOpen = open === v.item.id;
          const nextLine = v.next ? ` · next: ${v.next.due_date ? shortDay(v.next.due_date) : "in the tray"} ${v.next.kind === "equipment_return" || v.next.kind === "repair_back" ? "back to warehouse" : `out with ${whoOf(v.next).split(" ")[0]}`}` : "";
          return (
            <div key={v.item.id} className={`gear${pill.cls === "flag" ? " flag" : ""}${isOpen ? " open" : ""}`} data-testid="gear-card" data-item-id={v.item.id} data-state={v.state}>
              <button type="button" className="top" onClick={() => setOpen(isOpen ? null : v.item.id)}>
                <span className="gicon">{GEAR_ICONS[v.item.category] ?? GEAR_ICONS.other}</span>
                <span className="nm">
                  <b>{v.item.name}<span className="tag">{v.item.tag}</span></b>
                  <small>{v.detail}{nextLine}{v.item.status !== "active" ? ` · ${v.item.status}` : ""}</small>
                  <span><span className={`loc ${pill.cls}`} data-testid="gear-pill">{pill.label}</span></span>
                </span>
              </button>
              <div className="trail">
                <div className="k" style={{ marginBottom: 6 }}>Trail</div>
                {carried(v.item.id).length === 0 && <div className="tr"><span className="d">—</span><span>Never moved — at the warehouse since it was added.</span></div>}
                {carried(v.item.id).map((m) => (
                  <div key={m.id} className="tr">
                    <span className="d">{m.done_at ? shortDay(m.done_at.slice(0, 10)) : m.due_date ? shortDay(m.due_date) : "tray"}</span>
                    <span>{kindLabel(m)} · {m.title} · {whoOf(m)} · {m.status === "done" ? "done" : m.status === "tray" ? "in the tray" : m.status}</span>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  {pill.cls === "flag" && v.next && <button type="button" className="btn primary" onClick={() => onFindInTray(v.next!)} data-testid="gear-find-in-tray">Find it in the tray</button>}
                  <a className="btn" href={`/settings#equipment`}>Edit item</a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="note">Location is never typed — it is the last ticked movement that carried the item. Tap an item for its trail. Retired items keep their history.</p>
    </div>
  );
}
