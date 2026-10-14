/**
 * The Activity block (payments-merge brief §4.2, §6.7, Step 8a). Pure: the
 * newest invoice events in words, with every "Invoice viewed by customer" for
 * the same invoice folded into ONE line with a count — the old feed repeated
 * it once per view. Money stays in cents; the page formats it.
 */

export type ActivityEvent = { id: string; invoiceId: string; type: string; meta: Record<string, unknown>; createdAt: string };
export type ActivityInvoice = { id: string; number: string | null; kind: string; estimateId: string };

export type ActivityLine = {
  key: string;
  type: string;
  title: string;
  /** pay · send · draft · stop — the dot's colour. */
  tone: "pay" | "send" | "draft" | "stop" | "";
  invoiceLabel: string;
  estimateId: string | null;
  amountCents: number | null;
  detail: string | null;
  /** Newest event in the line; for a folded line, `firstAt` is the oldest. */
  at: string;
  firstAt: string;
  count: number;
};

const KIND: Record<string, string> = { deposit: "Deposit", progress: "Progress", final: "Final", variation: "Variation", standalone: "Invoice" };
const METHOD: Record<string, string> = { bank_transfer: "bank transfer", cash: "cash", stripe_card: "card", other: "other" };

function words(e: ActivityEvent): Pick<ActivityLine, "title" | "tone" | "amountCents" | "detail"> {
  const m = e.meta as { method?: string; amount_cents?: number; auto?: string; deposit_pct?: number; total_inc_cents?: number; reason?: string };
  const cents = (v: unknown) => (typeof v === "number" ? v : null);
  const reason = typeof m.reason === "string" && m.reason.trim() ? m.reason.trim() : null;
  switch (e.type) {
    case "payment_received": return { title: "Payment received", tone: "pay", amountCents: cents(m.amount_cents), detail: METHOD[m.method ?? ""] ?? null };
    case "payment_reversed": return { title: "Payment undone", tone: "stop", amountCents: cents(m.amount_cents), detail: reason };
    case "drafted":
      return {
        title: m.auto === "acceptance" ? "Deposit drafted on acceptance" : m.auto === "final" ? "Final invoice drafted at sign-off" : "Invoice drafted",
        tone: "draft", amountCents: cents(m.total_inc_cents), detail: m.auto === "acceptance" && m.deposit_pct ? `${m.deposit_pct}%` : null,
      };
    case "issued": return { title: "Invoice issued", tone: "send", amountCents: null, detail: null };
    case "sent": return { title: "Invoice sent", tone: "send", amountCents: null, detail: null };
    case "viewed": return { title: "Invoice viewed by customer", tone: "send", amountCents: null, detail: null };
    case "voided": return { title: "Invoice voided", tone: "stop", amountCents: null, detail: reason };
    case "written_off": return { title: "Invoice written off", tone: "stop", amountCents: null, detail: reason };
    case "reminders_paused": return { title: "Reminders paused", tone: "draft", amountCents: null, detail: reason };
    case "reminders_resumed": return { title: "Reminders resumed", tone: "send", amountCents: null, detail: null };
    case "nudge_sent": return { title: "Payment message sent", tone: "send", amountCents: null, detail: null };
    case "extension": return { title: "Payment terms extended", tone: "draft", amountCents: null, detail: null };
    case "amended": return { title: "Draft amended", tone: "draft", amountCents: null, detail: null };
    default: return { title: e.type.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()), tone: "", amountCents: null, detail: null };
  }
}

/** `events` newest first. Views of one invoice become one line, dated by its newest view. */
export function activityFeed(events: readonly ActivityEvent[], invoices: readonly ActivityInvoice[]): ActivityLine[] {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const lines: ActivityLine[] = [];
  const viewedLine = new Map<string, ActivityLine>();
  for (const e of events) {
    if (e.type === "viewed") {
      const seen = viewedLine.get(e.invoiceId);
      if (seen) { seen.count += 1; seen.firstAt = e.createdAt < seen.firstAt ? e.createdAt : seen.firstAt; continue; }
    }
    const inv = byId.get(e.invoiceId);
    const line: ActivityLine = {
      key: e.id, type: e.type, ...words(e),
      invoiceLabel: inv ? inv.number ?? `${KIND[inv.kind] ?? "Invoice"} draft` : "",
      estimateId: inv?.estimateId ?? null, at: e.createdAt, firstAt: e.createdAt, count: 1,
    };
    if (e.type === "viewed") viewedLine.set(e.invoiceId, line);
    lines.push(line);
  }
  for (const l of viewedLine.values()) if (l.count > 1) l.title = `Invoice viewed by customer, ${l.count} times`;
  return lines;
}
