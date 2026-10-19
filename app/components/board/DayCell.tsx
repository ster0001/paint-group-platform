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
 */
export function DayCell({ day, slots, slotHours }: { day: string; slots: BoardSlots; slotHours: [number, number] }) {
  const dow = dayParts(day).dow;
  return (
    <div data-day={day} data-label={dayLabel(day)} className={`bgc ${isWeekend(dow) ? "we" : ""}`}>
      {slots === "half" && (
        <>
          <div className="slot" data-slot="am" />
          <div className="slot" data-slot="pm" />
        </>
      )}
      {slots === "hour" && hourSlots(slotHours).map((h) => <div key={h} className="slot" data-slot={h} />)}
    </div>
  );
}

const hourSlots = ([from, to]: [number, number]) =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => `${String(from + i).padStart(2, "0")}:00`);
