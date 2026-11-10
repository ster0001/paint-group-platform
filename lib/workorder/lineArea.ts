import type { WOArea } from "./snapshot";

/**
 * A line item's crew time on the work order (5 Milton St, 10 Nov 2026: the
 * "Deck around Pool" line carried 10 h in the painter's PAY but never reached
 * the job sheet, so the sheet, the board and the offer said 27.1 h, not 37.1).
 *
 * Like the Preparation line (QuoteBuilder, 17 Sep), a line with hours rides the
 * work order as its own area with one surface, so the job sheet, the tick rows,
 * the offer's hours sum (`send_offer` sums areas → surfaces) and the board all
 * carry it with no special case downstream. Which lines: exactly the ones
 * `priceEstimateTotals` counts into the contractor's hours — every line with
 * hours, hidden and 3rd-party ones included — so the sheet's hours and the pay
 * are the same hours. A line with no hours stays off, as before.
 *
 * Contractor-safe: the line's name and its scope wording only — never its price.
 * The repair for documents frozen before this is migration 20270309, which
 * builds the same area in SQL; keep the two in step.
 */
export function lineAreaId(lineId: string | number): string {
  return `line-${lineId}`;
}

/** The hours-override key for a line's one surface (work_orders.hours_overrides). */
export function lineSurfaceKey(lineId: string | number): string {
  return `${lineAreaId(lineId)}:work`;
}

/** The line's scope wording as the plain text the painter's sheet prints. */
export function lineScopeText(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

export function lineWorkOrderArea(
  line: { id: string | number; name: string; description?: string | null; type?: string },
  hours: number,
  override?: number | null,
): WOArea | null {
  if (!(hours > 0)) return null;
  return {
    id: lineAreaId(line.id),
    title: line.name.trim() || "Line item",
    side: line.type === "Exterior" ? "exterior" : "interior",
    surfaces: [{
      key: lineSurfaceKey(line.id),
      label: line.name.trim() || "Line item",
      coats: 0, product: "",
      prep: lineScopeText(line.description),
      hours: override ?? Number(hours.toFixed(2)),
      // No painting/prep split: the sheet's "incl. … h prep" would mislabel a
      // deck clean or a plaster repair. The hours stand as one figure.
      paintingHours: 0, prepHours: 0, conditionHours: 0,
      status: "not_started",
    }],
    photos: [],
    finishCode: null,
    finishOverridden: false,
  };
}
