/** Display-edge money/date formatting for the invoicing screens. Formatting
 *  only — every figure arrives in cents, already computed by lib/invoicing. */

// A2-03: these WERE the shared formatter — the only one, ignored by 35 other
// definitions. They are now thin aliases over lib/format/money so the invoicing
// screens keep the names they use while there is one implementation. Note fmt2
// gains correct sign placement: it used to render "$-1,234.56".
export { money0 as fmt0, money as fmt2, moneySigned as fmtSigned2 } from "@/lib/format/money";
// …and imported for this file's own use: a re-export creates no local binding.
import { money as fmt2 } from "@/lib/format/money";

// A bare yyyy-mm-dd is already a Melbourne calendar day — format it as-is (in
// UTC so no zone shifts it); only real timestamps are converted to Melbourne.
// Never a hardcoded offset: Melbourne is +11 from October to April.
export const shortDay = (iso: string | null) =>
  iso
    ? iso.length === 10
      ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" })
          .format(new Date(iso + "T00:00:00Z"))
      : new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" })
          .format(new Date(iso))
    : "—";

export const KIND_LABEL: Record<string, string> = {
  deposit: "Deposit",
  progress: "Progress",
  final: "Final",
  variation: "Variation",
  standalone: "Invoice",
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  sent: "Sent",
  viewed: "Viewed",
  partially_paid: "Part paid",
  paid: "Paid",
  void: "Void",
  written_off: "Written off",
};

/**
 * The label a deposit invoice DESERVES (Tom, 25 Aug: a row reading
 * "$788.61 · Deposit" was mistaken for a mis-priced job total). Given the
 * job's contract figure, a deposit says what fraction of what it is —
 * "Deposit — 10% of $7,886.11"; every other kind keeps its plain label.
 * Display only; both cents figures come from the ledger.
 */
export function kindLabelWithContext(
  kind: string,
  totalIncCents: number,
  contractIncCents: number | null | undefined,
): string {
  const base = KIND_LABEL[kind] ?? kind;
  if (kind !== "deposit" || !contractIncCents || contractIncCents <= 0 || totalIncCents <= 0) return base;
  const pct = Math.round((totalIncCents / contractIncCents) * 100);
  if (pct <= 0 || pct >= 100) return base;
  return `${base} — ${pct}% of ${fmt2(contractIncCents)}`;
}
