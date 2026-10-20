import type { ReactNode } from "react";
import { dayLabel, dayParts, isWeekend } from "./format";
import type { BoardSlots } from "./types";

/**
 * One day of one lane: the drop target. `data-day` is what the drag engine
 * resolves the day from; `data-label` is what the hovered cell's pop-up says
 * while something is dragged over it (schedule.css `.bgc.hot::after`).
 *
 * With sub-slots the cell holds AM/PM halves or hourly rows, each carrying
 * `data-slot`; the engine reports the slot under the pointer alongside the
 * day. A plain cell (`slots="none"`) is the Schedule board's, unchanged.
 *
 * Movements (Session 4): a consumer may draw INSIDE a slot (`renderSlot`) and
 * above the slots (`head`) — context blocks, placed cards, the Nearby pill.
 * The Schedule board passes neither, so its cells render exactly as before.
 */
export function DayCell({ day, slots, slotHours, renderSlot, head }: {
  day: string; slots: BoardSlots; slotHours: [number, number];
  renderSlot?: (slot: string) => ReactNode;
  head?: ReactNode;
}) {
  const dow = dayParts(day).dow;
  return (
    <div data-day={day} data-label={dayLabel(day)} className={`bgc ${isWeekend(dow) ? "we" : ""}`}>
      {head}
      {slots === "half" && (
        <>
          <div className="slot" data-slot="am">{renderSlot?.("am")}</div>
          <div className="slot" data-slot="pm">{renderSlot?.("pm")}</div>
        </>
      )}
      {slots === "hour" && hourSlots(slotHours).map((h) => <div key={h} className="slot" data-slot={h}>{renderSlot?.(h)}</div>)}
    </div>
  );
}

/**
 * "07:00" … for whole hours; a fractional start (7.5) gives half-past rows
 * ("07:30" …) — ruling 16's 07:30–17:30 lanes. The row count is the span.
 */
export const hourSlots = ([from, to]: [number, number]) =>
  Array.from({ length: Math.max(0, Math.round(to - from)) }, (_, i) => {
    const h = from + i;
    const whole = Math.floor(h);
    const minutes = Math.round((h - whole) * 60);
    return `${String(whole).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  });
