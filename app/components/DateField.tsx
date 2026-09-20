"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Tom, 17 Sep 2026: "when clicking on the date box in the CRM, pop up with a
 * mini calendar to choose the date". One picker for every CRM date — the
 * follow-up, the snooze, the delay, a visit — in place of the browser's own
 * date box, which on a Mac is a typed dd/mm/yyyy with no calendar.
 *
 * Value in, value out is a plain `YYYY-MM-DD` day, exactly what the native
 * input gave, so nothing that saves a date changes. All the arithmetic is on
 * calendar days (UTC-pinned), never on instants: a day is a day whatever the
 * clock says.
 */
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parts = (day: string): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null;
};
/** Today as a local calendar day (the CRM's other pickers use the same idea). */
export const todayDay = () => new Date().toLocaleDateString("en-CA");

export function formatDay(day: string | null | undefined, empty = "Pick a date"): string {
  const p = day ? parts(day) : null;
  if (!p) return empty;
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(p[0], p[1], p[2])));
}

export default function DateField({ value, onChange, min, max, ariaLabel, className = "field datefield", testId, disabled = false }: {
  value: string;
  onChange: (day: string) => void;
  /** Earliest pickable day (inclusive), `YYYY-MM-DD`. */
  min?: string;
  max?: string;
  ariaLabel: string;
  className?: string;
  testId?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const start = parts(value) ?? parts(todayDay())!;
  const [view, setView] = useState<{ y: number; m: number }>({ y: start[0], m: start[1] });
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();

  // Opening lands on the month of the current value.
  const toggle = () => {
    if (!open) {
      const p = parts(value);
      if (p) setView({ y: p[0], m: p[1] });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const first = new Date(Date.UTC(view.y, view.m, 1));
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => ymd(view.y, view.m, i + 1))];
  while (cells.length % 7) cells.push(null);
  const today = todayDay();
  const tooEarly = (d: string) => Boolean(min && d < min);
  const tooLate = (d: string) => Boolean(max && d > max);
  const step = (delta: number) => setView((v) => {
    const d = new Date(Date.UTC(v.y, v.m + delta, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });

  return (
    <div className="datepick" ref={wrap} data-testid={testId}>
      <button
        type="button"
        className={className}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-cal`}
        disabled={disabled}
        onClick={toggle}
        data-testid={testId ? `${testId}-button` : undefined}
        data-value={value}
      >
        <span className="dp-ico" aria-hidden="true">▦</span>
        {formatDay(value)}
      </button>
      {open && (
        <div className="dp-pop" role="dialog" aria-label={`${ariaLabel} — calendar`} id={`${id}-cal`} data-testid={testId ? `${testId}-calendar` : undefined}>
          <div className="dp-head">
            <button type="button" className="dp-nav" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
            <span className="dp-month">{MONTHS[view.m]} {view.y}</span>
            <button type="button" className="dp-nav" aria-label="Next month" onClick={() => step(1)}>›</button>
          </div>
          <div className="dp-grid" role="grid">
            {WEEKDAYS.map((w) => <span key={w} className="dp-wd" role="columnheader">{w}</span>)}
            {cells.map((d, i) => d ? (
              <button
                key={d}
                type="button"
                role="gridcell"
                className={`dp-day${d === value ? " on" : ""}${d === today ? " today" : ""}`}
                disabled={tooEarly(d) || tooLate(d)}
                aria-selected={d === value}
                aria-label={formatDay(d)}
                data-day={d}
                onClick={() => { onChange(d); setOpen(false); }}
              >
                {Number(d.slice(8))}
              </button>
            ) : <span key={`b${i}`} className="dp-blank" />)}
          </div>
          <div className="dp-foot">
            <button type="button" className="dp-link" disabled={tooEarly(today) || tooLate(today)} onClick={() => { onChange(today); setOpen(false); }}>Today</button>
            <span className="dp-hint">{value ? formatDay(value) : ""}</span>
          </div>
        </div>
      )}
    </div>
  );
}
