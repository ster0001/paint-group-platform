/**
 * Customer notification preferences (Tom, 7 Sep 2026, item 3) — CLIENT-SAFE.
 *
 * The customer decides, in their portal, which kinds of message reach them
 * and on which channel. The vocabulary lives here so the portal page, the
 * CRM record and the send layer cannot drift. Unset means ON: a customer who
 * never opened the page gets everything, exactly as before.
 *
 * Marketing is NOT a type here — it is the per-channel permission on the
 * account (permit_email / permit_sms) with its own provenance, and the
 * campaign guard reads that. Sign-in links and anything the customer asked
 * for by hand are never subject to a preference: no `kind` on the send, no
 * lookup.
 */

export const NOTIFY_TYPES = [
  { key: "estimate", label: "Estimates", hint: "When an estimate is sent or updated, and reminders about it." },
  { key: "visit", label: "Visits", hint: "Visit confirmations and the day-before reminder." },
  { key: "job", label: "Property & job updates", hint: "Booking confirmations, progress updates, photos and sign-off." },
  { key: "invoice", label: "Invoices & payments", hint: "Invoices, receipts and payment reminders." },
  { key: "message", label: "Replies to your messages", hint: "When we answer something you sent us." },
] as const;
export type NotifyType = (typeof NOTIFY_TYPES)[number]["key"];

export const NOTIFY_CHANNELS = ["email", "sms"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];
export const CHANNEL_LABEL: Record<NotifyChannel, string> = { email: "Email", sms: "Text message" };

export type NotifyPrefs = Partial<Record<NotifyType, Partial<Record<NotifyChannel, boolean>>>>;

const isType = (k: string): k is NotifyType => NOTIFY_TYPES.some((t) => t.key === k);

/** The jsonb column, defensively: unknown keys and non-booleans are dropped. */
export function parseNotifyPrefs(raw: unknown): NotifyPrefs {
  const out: NotifyPrefs = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isType(k) || !v || typeof v !== "object") continue;
    const row: Partial<Record<NotifyChannel, boolean>> = {};
    for (const c of NOTIFY_CHANNELS) {
      const b = (v as Record<string, unknown>)[c];
      if (typeof b === "boolean") row[c] = b;
    }
    out[k] = row;
  }
  return out;
}

/** Unset means on. */
export function notifyAllowed(prefs: NotifyPrefs | null | undefined, type: NotifyType, channel: NotifyChannel): boolean {
  return prefs?.[type]?.[channel] !== false;
}

/**
 * The `kind` a send site puts on its MessageContext → the customer-facing
 * type it belongs to. Null = not a customer notification (auth links,
 * office mail, campaigns, anything untagged): never suppressed here.
 */
const KIND_RULES: Array<[NotifyType, RegExp]> = [
  ["visit", /^visit/],
  ["estimate", /^(estimate|revision|quote)/],
  ["invoice", /^(invoice|receipt|payment|deposit)/],
  ["job", /^(job|appointment|pre_start|walkthrough|signoff|sign_off|variation|update|booking)/],
  ["message", /^(reply|chat|message)/],
];
export function notifyTypeOfKind(kind: string | null | undefined): NotifyType | null {
  if (!kind) return null;
  for (const [type, re] of KIND_RULES) if (re.test(kind)) return type;
  return null;
}

/** The channels a customer has switched OFF, for the CRM record's summary. */
export function switchedOff(prefs: NotifyPrefs | null | undefined): Array<{ type: NotifyType; channel: NotifyChannel }> {
  const out: Array<{ type: NotifyType; channel: NotifyChannel }> = [];
  for (const t of NOTIFY_TYPES) for (const c of NOTIFY_CHANNELS) if (prefs?.[t.key]?.[c] === false) out.push({ type: t.key, channel: c });
  return out;
}

export const ALWAYS_SENT_NOTE = "Sign-in links, and anything you ask us for directly, are always sent.";
