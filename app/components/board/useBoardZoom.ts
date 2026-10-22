"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, todayIso } from "@/lib/scheduling/dates";

export type BoardZoomOptions = {
  /** The window the server rendered for. */
  from: string;
  rangeDays: number;
  /**
   * Called (debounced) when the window moves away from what the server
   * rendered, so the caller can push it into the URL and refetch. Paging or
   * jumping used to move the columns while the blocks stayed behind, so a job
   * booked months out was invisible.
   */
  onWindowChange?: (start: string, range: number) => void;
  /** Range presets, in days. */
  presets?: number[];
  initialDayW?: number;
  /** Slider / ± bounds. */
  minDayW?: number;
  maxDayW?: number;
  /** Fit-to-range may go narrower than the slider's minimum. */
  fitMinDayW?: number;
  step?: number;
  debounceMs?: number;
};

export type BoardZoom = ReturnType<typeof useBoardZoom>;

/**
 * Window + zoom: the visible start date, how many days, how wide a day is.
 * Zoom is driven entirely by --day-w (written by <Board>), so changing it
 * animates every block at once instead of forcing a re-layout of the grid.
 */
export function useBoardZoom({
  from,
  rangeDays,
  onWindowChange,
  presets = [14, 28, 56],
  initialDayW = 64,
  minDayW = 24,
  maxDayW = 140,
  fitMinDayW = 14,
  step = 12,
  debounceMs = 250,
}: BoardZoomOptions) {
  const [dayW, setDayW] = useState(initialDayW);
  const [range, setRange] = useState(rangeDays);
  const [start, setStart] = useState(from);
  // Tom, 22 Oct 2026: the Movements tab moves weeks by changing `from` (a new URL, the same
  // mounted screen); the window follows it. State derived from a prop, set during render.
  const [seenFrom, setSeenFrom] = useState(from);
  if (from !== seenFrom) {
    setSeenFrom(from);
    setStart(from);
  }
  // The horizontal scroller (`main.tl`) — fit-to-range measures it. Kept
  // behind a setter and a getter rather than a ref object so the hook's
  // return value carries no ref (the React Compiler would otherwise treat
  // everything destructured from it as non-reactive).
  const tl = useRef<HTMLElement | null>(null);
  const setScrollerEl = useCallback((el: HTMLElement | null) => { tl.current = el; }, []);
  const scrollerEl = useCallback(() => tl.current, []);

  /**
   * Picking 2W/4W/8W should CHANGE THE SIZE of the view, not just stretch the
   * board off the right-hand edge — so the day width is recomputed to fit the
   * whole range in the space available. The zoom slider still overrides it.
   */
  const fitRange = useCallback((n: number) => {
    setRange(n);
    const avail = (tl.current?.clientWidth ?? 0) - 32; // padding
    if (avail > 0) setDayW(Math.max(fitMinDayW, Math.min(maxDayW, Math.floor(avail / n))));
  }, [fitMinDayW, maxDayW]);

  const zoomIn = useCallback(() => setDayW((w) => Math.min(maxDayW, w + step)), [maxDayW, step]);
  const zoomOut = useCallback(() => setDayW((w) => Math.max(minDayW, w - step)), [minDayW, step]);

  const days = useMemo(() => Array.from({ length: range }, (_, i) => addDays(start, i)), [start, range]);
  const today = todayIso();

  // The callback lives in a ref so a caller passing an inline closure does not
  // restart the debounce on every render.
  const onChange = useRef(onWindowChange);
  useEffect(() => { onChange.current = onWindowChange; });
  useEffect(() => {
    if (start === from && range === rangeDays) return;
    const t = setTimeout(() => onChange.current?.(start, range), debounceMs); // debounce: dragging the range buttons shouldn't fire a fetch each time
    return () => clearTimeout(t);
  }, [start, range, from, rangeDays, debounceMs]);

  return {
    dayW, setDayW, minDayW, maxDayW,
    range, fitRange, presets,
    start, setStart,
    days, today,
    setScrollerEl, scrollerEl,
    zoomIn, zoomOut,
    back: () => setStart(addDays(start, -range)),
    next: () => setStart(addDays(start, range)),
    toToday: () => setStart(todayIso()),
  };
}
