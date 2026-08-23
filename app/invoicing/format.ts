/** Display-edge money/date formatting for the invoicing screens. Formatting
 *  only — every figure arrives in cents, already computed by lib/invoicing. */

export const fmt0 = (cents: number) =>
  "$" + Math.round(cents / 100).toLocaleString("en-AU");

export const fmt2 = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtSigned2 = (cents: number) => (cents < 0 ? "−" + fmt2(-cents) : fmt2(cents));

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
