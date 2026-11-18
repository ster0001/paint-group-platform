import type { CustomerPayload, CustomerRoomView } from "@/lib/wizard/view";
import type { QuoteBreakdown } from "@/lib/pricing/quoteBreakdown";
import type { QuoteRoom } from "./cards";

/**
 * QUOTE STAGE v10 §5 — THE QUOTE DOCUMENT, as data (R4: the quote writes
 * itself and is the progress device). Pure: the words and numbers of the
 * header, the prepared-for block, one line per room (its size, "(typical)"
 * while the typical stands, what is included, its amount once it is
 * settled), the repairs line, the Subtotal / GST / total rows — all read from
 * the server's payload (per-room ranges and the GST rows come from
 * `customerPayload`; nothing here does arithmetic on money) — plus the
 * summary the tile and the band read: lines to go, minutes, settled share.
 */
export type PreparedFor = { name: string | null; address: string | null; mobile: string | null; email: string | null };

export type QuoteLine = {
  areaId: number;
  name: string;
  /** "3.5 × 3.2 × 2.4 m" (+ " (typical)" while the typical stands). */
  size: string;
  typical: boolean;
  /** What is included — the room's summary from the payload. */
  included: string;
  /** "$1,230 – $1,480" once the line is settled; "—" while it is open. */
  amount: string;
  state: "todo" | "typical" | "measured";
};
/** Go-live H1: a dollar line that is not a room — set-up and preparation, cleaning, specialist work, a size allowance, a discount. */
export type QuoteExtraLine = { key: string; label: string; detail: string; amount: string; loCents: number; hiCents: number };
export type QuoteDocument = {
  title: "Draft quote" | "Quote";
  number: string;
  date: string;
  validity: string;
  preparedFor: PreparedFor;
  lines: QuoteLine[];
  /** H1: the lines after the rooms, so every dollar in the Subtotal has a line. Empty on a payload from before the breakdown. */
  extras: QuoteExtraLine[];
  repairsLine: string;
  /** H1: one GST basis, said on the rows — the lines and the Subtotal are ex GST, the total is inc GST. */
  subtotalLabel: string;
  subtotal: string | null;
  gstLabel: string;
  gst: string | null;
  totalLabel: "Your range" | "Your price";
  total: string;
  settledShare: number;
};

/** The words of the non-room lines (H1). The dollars come from `lib/pricing/quoteBreakdown.ts`; nothing here adds up. */
export const EXTRA_LINE_WORDS: Record<string, { label: string; detail: string }> = {
  prep: { label: "Set-up and preparation", detail: "Protection, filling and sanding — repairs allowed for, confirmed on the day" },
  cleaning: { label: "Cleaning", detail: "Each day, and a final clean" },
  specialist: { label: "Specialist work", detail: "Priced with your estimator" },
  size: { label: "Job size allowance", detail: "" },
  discount: { label: "Discount", detail: "" },
};
export function quoteExtraLines(breakdown: QuoteBreakdown | null | undefined): QuoteExtraLine[] {
  if (!breakdown) return [];
  return breakdown.lines
    .filter((l) => !l.key.startsWith("room:") && (l.loCents !== 0 || l.hiCents !== 0))
    .map((l) => {
      const w = EXTRA_LINE_WORDS[l.key] ?? { label: l.key, detail: "" };
      return { key: l.key, label: w.label, detail: w.detail, amount: range(l.loCents, l.hiCents), loCents: l.loCents, hiCents: l.hiCents };
    });
}
export type QuoteSummary = { toGo: number; minutes: number; settledShare: number; allSettled: boolean };

const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;
const range = (lo: number, hi: number) => `${fmt(lo)} – ${fmt(hi)}`;
const dims = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

/** A line's state: the size answered by typing (measured), by taking the typical (typical), or not yet (todo). */
export function lineState(r: Pick<QuoteRoom, "size" | "confirmed">): QuoteLine["state"] {
  if (r.size === "adjusted") return "measured";
  if (r.size === "yes" || r.confirmed) return "typical";
  return "todo";
}

export function quoteLines(rooms: QuoteRoom[], views: CustomerRoomView[], breakdown: QuoteBreakdown | null = null): QuoteLine[] {
  return rooms.map((r) => {
    const v = views.find((x) => x.areaId === r.areaId);
    const state = lineState(r);
    const settled = state !== "todo";
    // H1: the room's share of the Subtotal (ex GST, whole dollars — the lines add up); a payload from before the
    // breakdown falls back to the room's own range.
    const share = breakdown?.lines.find((l) => l.key === `room:${r.areaId}`) ?? null;
    const amount = !settled ? "—"
      : share ? range(share.loCents, share.hiCents)
      : v?.rangeLoCents != null && v.rangeHiCents != null ? range(v.rangeLoCents, v.rangeHiCents) : "—";
    return {
      areaId: r.areaId, name: r.name,
      size: `${r.kind === "side" ? `${dims(r.lengthM)} × ${dims(r.widthM)} m` : `${dims(r.widthM)} × ${dims(r.lengthM)} × ${dims(r.heightM)} m`}${state === "measured" ? "" : " (typical)"}`,
      typical: state !== "measured", included: v?.summary ?? "", amount, state,
    };
  });
}

/** The tile's words and the band's share: lines still open (todo), ~minutes at four taps a room, settled = not todo. */
export function quoteSummary(rooms: QuoteRoom[], generalToGo: number): QuoteSummary {
  const open = rooms.filter((r) => lineState(r) === "todo").length;
  const toGo = open + generalToGo;
  const minutes = Math.max(1, Math.ceil((open * 4 + generalToGo) * 7 / 60));
  const settledShare = rooms.length ? (rooms.length - open) / rooms.length : 1;
  return { toGo, minutes, settledShare, allSettled: open === 0 && generalToGo === 0 };
}

export function quoteDocument(i: {
  payload: Pick<CustomerPayload, "rooms" | "rangeLoCents" | "rangeHiCents" | "quoteTotals" | "quoteBreakdown">;
  rooms: QuoteRoom[];
  preparedFor: PreparedFor;
  number: string;
  date: string;
  generalToGo: number;
  /** Go-live D5: how long the quote stands — Settings `wizard_hold_days`, never a number typed here. */
  validDays: number;
}): QuoteDocument {
  const b = i.payload.quoteBreakdown ?? null;
  const lines = quoteLines(i.rooms, i.payload.rooms, b);
  const summary = quoteSummary(i.rooms, i.generalToGo);
  const t = i.payload.quoteTotals ?? null;
  // H1: with the breakdown, every row reads from it — the lines add to the Subtotal and the Subtotal and GST to the total.
  const subtotal = b ? range(b.subtotalLoCents, b.subtotalHiCents) : t ? range(t.subtotalLoCents, t.subtotalHiCents) : null;
  const gst = b ? range(b.gstLoCents, b.gstHiCents) : t ? range(t.gstLoCents, t.gstHiCents) : null;
  const total = b ? range(b.totalLoCents, b.totalHiCents) : range(i.payload.rangeLoCents, i.payload.rangeHiCents);
  return {
    title: summary.allSettled ? "Quote" : "Draft quote",
    number: i.number, date: i.date, validity: `Valid ${i.validDays} days · Includes GST`,
    preparedFor: i.preparedFor,
    lines,
    extras: quoteExtraLines(b),
    repairsLine: "Repairs allowed for — confirmed on the day",
    subtotalLabel: "Subtotal · ex GST",
    subtotal,
    gstLabel: "GST",
    gst,
    totalLabel: summary.allSettled ? "Your price" : "Your range",
    total,
    settledShare: summary.settledShare,
  };
}

/** A quote number from the estimate id, prefixed by the shopfront — the row has no human number of its own. */
export function quoteNumber(estimateId: string, brand: "painthome" | "paintgroup"): string {
  return `${brand === "painthome" ? "PH" : "PG"}-${estimateId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
