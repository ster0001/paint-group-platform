/**
 * UI refresh S4/S5: the price card's band — the dashed outline is where the
 * guide range started (the range the page opened with), the bar is the range
 * now. Positions only, as CSS percentages; no money is computed here. One
 * function for the room editor and the side-by-side editor.
 */
export type Band = { was: { left: string; width: string }; now: { left: string; width: string } };

export function rangeBand(start: { lo: number; hi: number }, now: { lo: number; hi: number }): Band {
  const { lo: g0, hi: g1 } = start;
  const pad = Math.max(1, (g1 - g0) * 0.12);
  const mn = Math.min(g0, now.lo) - pad, mx = Math.max(g1, now.hi) + pad;
  const at = (v: number) => `${((v - mn) / (mx - mn)) * 100}%`;
  const w = (a: number, b: number) => `${((b - a) / (mx - mn)) * 100}%`;
  return { was: { left: at(g0), width: w(g0, g1) }, now: { left: at(now.lo), width: w(now.lo, now.hi) } };
}
