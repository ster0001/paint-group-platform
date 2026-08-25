/**
 * Rule-based bill reading — the deterministic half of the extraction
 * interface. Runs on every document's text (email body, text attachment);
 * the AI reader (extractBill.ts) proposes on top of it when a key exists.
 * Pure and unit-tested; never invents an amount — a field it cannot see is
 * simply absent.
 */

import type { ExtractedBill } from "./intake";

const MONEY = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/;

function centsFrom(match: string | undefined): number | undefined {
  if (!match) return undefined;
  const n = Number(match.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 100);
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "22/08/2026", "22-8-26" or "22 Aug 2026" → YYYY-MM-DD (AU day-first). */
export function parseAuDate(raw: string): string | undefined {
  const numeric = raw.match(/\b([0-3]?\d)[\/\-]([01]?\d)[\/\-](\d{2,4})\b/);
  if (numeric) {
    const d = Number(numeric[1]);
    const m = Number(numeric[2]);
    let y = Number(numeric[3]);
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2000 && y <= 2100) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const worded = raw.match(/\b([0-3]?\d)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{4})?\b/i);
  if (worded) {
    const d = Number(worded[1]);
    const m = MONTHS[worded[2].toLowerCase()];
    const y = worded[3] ? Number(worded[3]) : undefined;
    if (d >= 1 && d <= 31 && m && y && y >= 2000 && y <= 2100) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return undefined;
}

/**
 * The sender that MATTERS. Staff forward supplier emails to bills@, so the
 * envelope sender is often our own forwarder (info@…, a billing gmail) —
 * learning THAT into vendor memory would prefill the wrong vendor on every
 * forwarded email. For a forwarded message, dig the original sender out of
 * the quoted "From:" line; otherwise the envelope sender stands.
 */
export function effectiveSender(fromEmail: string, subject: string, text: string): string {
  const forwarded = /^\s*(fwd?|fw):/i.test(subject) || /forwarded message/i.test(text);
  if (!forwarded) return fromEmail.toLowerCase();
  const m =
    text.match(/from:\s*[^<\n]*<\s*([\w.+'-]+@[\w.-]+\.[a-z]{2,})\s*>/i) ??
    text.match(/from:\s*([\w.+'-]+@[\w.-]+\.[a-z]{2,})/i);
  return (m?.[1] ?? fromEmail).toLowerCase();
}

/** Every PG-<n> job reference in the text (⚑A3/⚑21), plus WO-XXXXXXXX refs. */
export function orderRefsIn(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/\bPG[-\s]?0*(\d{1,6})\b/gi)) {
    refs.add(`PG-${m[1]}`);
  }
  for (const m of text.matchAll(/\bWO-([A-Z0-9]{8})\b/gi)) {
    refs.add(`WO-${m[1].toUpperCase()}`);
  }
  return [...refs];
}

/**
 * Read what the rules can see. Confidence is honest and fixed per rule:
 * an order reference is near-certain (0.95); a labelled total is likely but
 * not certain (0.6); nothing is guessed.
 */
export function ruleExtract(text: string, fromEmail: string, subject: string): ExtractedBill {
  const out: ExtractedBill = { confidence: {} };
  const conf = out.confidence as Record<string, number>;
  const t = text.slice(0, 20000);

  const invoiceNo = firstMatch(t, [
    /invoice\s*(?:no\.?|number|#)\s*[:\s]\s*([A-Z0-9][A-Z0-9\/-]{1,24})/i,
    /tax invoice\s+([A-Z]{1,4}-?\d{3,10})\b/i,
    /\b(?:docket|reference)\s*(?:no\.?|#)?\s*[:\s]\s*([A-Z0-9][A-Z0-9\/-]{1,24})/i,
  ]);
  if (invoiceNo) {
    out.invoice_no = invoiceNo;
    conf.invoice_no = 0.6;
  }

  const abn = t.match(/\bABN[:\s]*(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})\b/i);
  if (abn) {
    out.abn = abn[1].replace(/\s/g, "");
    conf.abn = 0.8;
  }

  const totalInc = centsFrom(
    firstMatch(t, [
      new RegExp(`total\\s*(?:inc[.a-z ]*gst|amount|due|payable)?\\s*[:\\s]\\s*${MONEY.source}`, "i"),
      new RegExp(`amount\\s*due\\s*[:\\s]\\s*${MONEY.source}`, "i"),
      new RegExp(`balance\\s*due\\s*[:\\s]\\s*${MONEY.source}`, "i"),
    ]),
  );
  if (totalInc) {
    out.total_cents = totalInc;
    conf.total_cents = 0.6;
  }

  const gst = centsFrom(firstMatch(t, [new RegExp(`\\bGST\\b[^0-9$\\n]*${MONEY.source}`, "i")]));
  if (gst && (!totalInc || gst < totalInc)) {
    out.gst_cents = gst;
    conf.gst_cents = 0.6;
    if (totalInc) {
      out.subtotal_ex_cents = totalInc - gst;
      conf.subtotal_ex_cents = 0.6;
    }
  }

  const dated = firstMatch(t, [
    /(?:invoice\s*)?date[:\s]+([0-3]?\d[\/\-][01]?\d[\/\-]\d{2,4})/i,
    /(?:invoice\s*)?date[:\s]+([0-3]?\d\s+[A-Za-z]{3,9}\.?\s*\d{4})/i,
  ]);
  const parsedDate = dated ? parseAuDate(dated) : parseAuDate(t);
  if (parsedDate) {
    out.invoice_date = parsedDate;
    conf.invoice_date = dated ? 0.7 : 0.4;
  }

  const refs = orderRefsIn(`${subject}\n${t}`);
  if (refs.length > 0) {
    out.order_ref = refs[0];
    conf.order_ref = 0.95;
  }

  // Supplier: the sender's display name or domain — vendor memory does the
  // real work; this is only a readable label for the queue card.
  const domain = fromEmail.split("@")[1]?.toLowerCase() ?? "";
  if (domain) {
    const label = domain.replace(/\.(com|net|org)?\.?(au)?$/i, "").split(".")[0];
    if (label) {
      out.supplier = label.charAt(0).toUpperCase() + label.slice(1);
      conf.supplier = 0.4;
    }
  }

  out.job_hints = refs;
  return out;
}

/**
 * Merge the AI proposal over the rule reading. The rules' order reference
 * wins (deterministic beats generative); everything else prefers the AI
 * field when present, keeping its confidence.
 */
export function mergeExtractions(rules: ExtractedBill, ai: ExtractedBill | null): ExtractedBill {
  if (!ai) return rules;
  const merged: ExtractedBill = {
    ...rules,
    ...Object.fromEntries(Object.entries(ai).filter(([, v]) => v !== undefined && v !== null)),
    confidence: { ...(rules.confidence ?? {}), ...(ai.confidence ?? {}) },
  };
  if (rules.order_ref) {
    merged.order_ref = rules.order_ref;
    (merged.confidence as Record<string, number>).order_ref = 0.95;
  }
  const hints = new Set([...(rules.job_hints ?? []), ...(ai.job_hints ?? [])]);
  merged.job_hints = [...hints];
  return merged;
}

/** A reading counts as usable when it saw money or an identity; otherwise the
 *  document fails loudly into the queue — never silently to $0. */
export function isReadable(e: ExtractedBill): boolean {
  return Boolean(e.total_cents || (e.supplier && e.invoice_no));
}
