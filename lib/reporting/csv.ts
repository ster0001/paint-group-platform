/**
 * Session 1 — CSV for the one export route. Rows are the metric's own rows,
 * columns the metric's own list, so what is exported is what the tile
 * counted (acceptance 5). Streams: a 10k-row export must not be built in
 * memory as one string first.
 */
import type { AnyMetricDef } from "./registry";

/** RFC 4180: quote when needed, double the quotes inside, CRLF between rows. */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  // A leading = + - @ is a formula to a spreadsheet: neutralise it (CSV injection).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, "\"\"")}"` : safe;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

export function* csvLines(def: AnyMetricDef, rows: Record<string, unknown>[]): Generator<string> {
  yield csvLine(def.columns.map((c) => c.label));
  for (const r of rows) yield csvLine(def.columns.map((c) => r[c.key]));
}

/** A web ReadableStream of the CSV, with a BOM so Excel reads UTF-8. */
export function csvStream(def: AnyMetricDef, rows: Record<string, unknown>[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const it = csvLines(def, rows);
  let first = true;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const n = it.next();
      if (n.done) { controller.close(); return; }
      controller.enqueue(enc.encode((first ? "﻿" : "") + n.value));
      first = false;
    },
  });
}

export function csvFilename(def: AnyMetricDef, range: { from: string; to: string } | null): string {
  const key = def.key.replace(/[^a-z0-9_.]/gi, "_");
  return range ? `${key}_${range.from}_to_${range.to}.csv` : `${key}_now.csv`;
}
