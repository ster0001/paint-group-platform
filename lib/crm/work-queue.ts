import type { SupabaseClient } from "@supabase/supabase-js";
import { invoiceIsOverdue, invoiceBalanceCents, type DeriveInvoice, type DerivePayment } from "@/lib/invoicing/derive";
import { OPEN_STATUSES } from "@/lib/invoicing/stateMachine";

/**
 * The work queue (shell brief §3) — the one answer to "what needs a human?".
 *
 * Derived, never stored. A work item is a fact about the world, computed:
 * Sarah's question is outstanding because no reply has been sent, not because
 * a task row exists. Reply to her and the item disappears — nothing to tick.
 * There is no work_items table, and a PR that adds one fails review.
 *
 * The durable rule this file enforces for every module, including ones not
 * designed yet: a module that needs to tell a person something emits a work
 * item here — one source function plus a registry entry. It does not build
 * its own list, badge, inbox or queue. Two implementations of "what needs
 * attention" is a single-source violation.
 *
 * Today, the tab badge and every filter chip all call `buildWorkQueue`. The
 * chips are filters over the same computed list, never separate queries.
 */

// ---- item shape (brief §3.2) ----------------------------------------------

export const WORK_ITEM_KINDS = [
  "message_unanswered",
  "message_unmatched",
  "followup_due",
  "snooze_expired",
  "callback_requested",
  "approval_pending",
  "invoice_action",
  "visit_rebook",
  "variation_pending",
  "signoff_due",
  "broadcast_incomplete",
  "consent_missing",
  /** Assistant S6: a customer asked for a change on a SENT estimate. */
  "change_request",
  /** Assistant S7: a customer is waiting for a person in a live chat. */
  "handoff_requested",
] as const;

export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

export type WorkItemBucket = "overdue" | "today" | "waiting";

export type SubjectRef = {
  type: "account" | "estimate" | "invoice" | "work_order" | "visit" | "event" | "campaign_queue" | "thread";
  id: string;
};

export type WorkItem = {
  /** Deterministic and stable across recomputes — §3.4. Same fact, same key,
   *  every time, or dismissals and read-state break. */
  key: string;
  kind: WorkItemKind;
  /** Null only where the record genuinely has no account — an invoice on one
   *  of the pre-spine estimates that never captured contact. The brief types
   *  this as required; reality on this database does not, and pretending
   *  otherwise would silently drop real money items. */
  accountId: string | null;
  subjectRef: SubjectRef;
  title: string;
  /** One line of context, drawn from the record. */
  detail: string;
  /** When it became outstanding. */
  since: string;
  /** When it goes overdue. Null = no deadline, it just waits. */
  dueAt: string | null;
  bucket: WorkItemBucket;
  priority: number;
  /** Exactly one action. An item offering three choices is an item nobody
   *  has decided the shape of. */
  action: { label: string; href: string };
};

// ---- keys (§3.4) -----------------------------------------------------------

export function itemKey(kind: WorkItemKind, subjectType: SubjectRef["type"], subjectId: string, discriminator: string): string {
  return `${kind}:${subjectType}:${subjectId}:${discriminator}`;
}

// ---- priority (§3.6) -------------------------------------------------------

/**
 * Which kinds the customer can see going unanswered. An unanswered question
 * beats an internal approval; chasing our own money or approving our own
 * campaign is ours to schedule.
 */
const CUSTOMER_VISIBLE: ReadonlySet<WorkItemKind> = new Set([
  "message_unanswered",
  "callback_requested",
  "visit_rebook",
  "signoff_due",
  "change_request",
  "handoff_requested",
]);

export function isCustomerVisible(kind: WorkItemKind): boolean {
  return CUSTOMER_VISIBLE.has(kind);
}

/**
 * ⚑7.2 — these weights are defaults chosen to be defensible, not ruled. They
 * live in one object so Tom's ruling is a one-line change and not a hunt.
 */
export const KIND_WEIGHT: Record<WorkItemKind, number> = {
  message_unanswered: 26,
  callback_requested: 24,
  message_unmatched: 18,
  visit_rebook: 22,
  signoff_due: 20,
  snooze_expired: 16,
  followup_due: 14,
  invoice_action: 18,
  variation_pending: 16,
  approval_pending: 10,
  broadcast_incomplete: 6,
  consent_missing: 4,
  change_request: 24,
  handoff_requested: 30,
};

export type PriorityInput = {
  kind: WorkItemKind;
  /** Value at stake in cents, when the record knows it. */
  valueCents: number | null;
  /** Days past dueAt (0 when not yet due). */
  overdueDays: number;
  /** A dated commitment recorded to the customer — "breakdown by the 10th". */
  promisedToCustomer: boolean;
};

/**
 * One pure function. Two rules that aren't negotiable, both under test:
 *  - A promise made to a customer outranks value. The promise band (+100) is
 *    unreachable by the value term, which is capped at 25.
 *  - Anything customer-visible outranks anything internal at equal urgency:
 *    the visibility band (+40) exceeds the whole spread of kind weights.
 */
export function priorityOf(input: PriorityInput): number {
  let score = KIND_WEIGHT[input.kind];
  if (isCustomerVisible(input.kind)) score += 40;
  if (input.promisedToCustomer) score += 100;
  score += Math.min(Math.max(input.overdueDays, 0), 14) * 2;
  if (input.valueCents != null) score += Math.min(input.valueCents / 100_000, 25); // $1k → 1 point, capped
  return score;
}

// ---- buckets ---------------------------------------------------------------

const MELBOURNE_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
});

/** The office's calendar day, not the server's. */
export function melbourneDay(d: Date): string {
  return MELBOURNE_DAY.format(d);
}

/**
 * Overdue = the deadline day has passed; today = it is that day (or the item
 * is actionable now with no deadline); waiting = the ball is with them.
 */
export function bucketFor(dueAt: string | null, now: Date): WorkItemBucket {
  if (!dueAt) return "today";
  const due = new Date(dueAt);
  const dueDay = melbourneDay(due);
  const nowDay = melbourneDay(now);
  if (dueDay < nowDay) return "overdue";
  if (dueDay > nowDay) return "waiting";
  return "today";
}

export function overdueDays(dueAt: string | null, now: Date): number {
  if (!dueAt) return 0;
  const ms = now.getTime() - new Date(dueAt).getTime();
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

// ---- filter groups (Today's chips, §4.2) -----------------------------------

export const FILTER_GROUPS = ["all", "messages", "followups", "approvals", "money"] as const;
export type FilterGroup = (typeof FILTER_GROUPS)[number];

export const GROUP_OF_KIND: Record<WorkItemKind, Exclude<FilterGroup, "all">> = {
  message_unanswered: "messages",
  message_unmatched: "messages",
  callback_requested: "messages",
  followup_due: "followups",
  snooze_expired: "followups",
  visit_rebook: "followups",
  approval_pending: "approvals",
  variation_pending: "approvals",
  signoff_due: "approvals",
  broadcast_incomplete: "approvals",
  consent_missing: "approvals",
  invoice_action: "money",
  change_request: "messages",
  handoff_requested: "messages",
};

// ---- source: snooze_expired (§3.3) -----------------------------------------

export type SnoozeAccountRow = {
  id: string;
  name: string | null;
  email: string;
  snoozed_until: string | null;
  followup_due_at: string | null;
  followup_note: string | null;
};

export type SnoozeReasonRow = { account_id: string; payload: { reason?: string } | null; occurred_at: string };

/**
 * A staff-set date has passed — a snooze ("call late Aug") or a follow-up
 * reminder. Both are the office's own written intent coming due, which is why
 * a reminder with a note counts as a promise: someone told the customer
 * something would happen by then, and wrote it down.
 */
export function buildSnoozeItems(accounts: SnoozeAccountRow[], reasons: SnoozeReasonRow[], now: Date): WorkItem[] {
  const reasonOf = new Map<string, string>();
  for (const r of reasons) {
    // Rows arrive newest-first; keep the first (latest) reason per account.
    if (!reasonOf.has(r.account_id) && r.payload?.reason) reasonOf.set(r.account_id, r.payload.reason);
  }

  const items: WorkItem[] = [];
  for (const a of accounts) {
    const who = a.name || a.email;
    if (a.snoozed_until && new Date(a.snoozed_until) <= now) {
      const reason = reasonOf.get(a.id);
      const due = a.snoozed_until;
      items.push(finish({
        key: itemKey("snooze_expired", "account", a.id, "snooze"),
        kind: "snooze_expired",
        accountId: a.id,
        subjectRef: { type: "account", id: a.id },
        title: `${who} — snooze expired`,
        detail: reason ? `You noted: “${reason}”` : "Snoozed with no note. It's back.",
        since: due,
        dueAt: due,
        action: { label: "Open", href: `/crm/customers/${a.id}` },
      }, { valueCents: null, promisedToCustomer: false }, now));
    }
    if (a.followup_due_at && new Date(a.followup_due_at) <= now) {
      const due = a.followup_due_at;
      items.push(finish({
        key: itemKey("snooze_expired", "account", a.id, "reminder"),
        kind: "snooze_expired",
        accountId: a.id,
        subjectRef: { type: "account", id: a.id },
        title: `${who} — follow-up reminder due`,
        detail: a.followup_note || "Reminder set with no note.",
        since: due,
        dueAt: due,
        action: { label: "Open", href: `/crm/customers/${a.id}` },
      }, { valueCents: null, promisedToCustomer: !!a.followup_note?.trim() }, now));
    }
  }
  return items;
}

// ---- source: invoice_action (§3.3) -----------------------------------------

export type QueueInvoiceRow = DeriveInvoice & {
  accountId: string | null;
  customerName: string | null;
  jobAddress: string | null;
};

/**
 * Deposit unpaid, invoice overdue. The judgement calls are lib/invoicing's —
 * `invoiceIsOverdue` and `invoiceBalanceCents` decide, this function only
 * phrases. This IS the old invoicing attention surface, generalised; the
 * dashboard keeps its tiles (they are figures, not a to-do list) but the
 * to-do half lives only here.
 */
export function buildInvoiceItems(invoices: QueueInvoiceRow[], payments: DerivePayment[], now: Date): WorkItem[] {
  const todayIso = now.toISOString().slice(0, 10);
  const items: WorkItem[] = [];
  for (const inv of invoices) {
    const balance = invoiceBalanceCents(inv, payments);
    if (balance <= 0) continue;
    const who = inv.customerName || inv.jobAddress || "a job";
    const money = "$" + Math.round(balance / 100).toLocaleString("en-AU");
    const overdue = invoiceIsOverdue(inv, payments, todayIso);
    const href = inv.accountId ? `/crm/customers/${inv.accountId}` : `/invoicing/job/${inv.estimateId}`;

    if (inv.kind === "deposit") {
      items.push(finish({
        key: itemKey("invoice_action", "invoice", inv.id, "deposit"),
        kind: "invoice_action",
        accountId: inv.accountId,
        subjectRef: { type: "invoice", id: inv.id },
        title: `${who} — deposit unpaid`,
        detail: `${money} outstanding. The job shouldn't start without it.`,
        since: inv.issuedOn ?? todayIso,
        dueAt: inv.dueOn,
        action: { label: "Chase", href },
      }, { valueCents: balance, promisedToCustomer: false }, now));
    } else if (overdue) {
      items.push(finish({
        key: itemKey("invoice_action", "invoice", inv.id, "overdue"),
        kind: "invoice_action",
        accountId: inv.accountId,
        subjectRef: { type: "invoice", id: inv.id },
        title: `${who} — invoice overdue`,
        detail: `${money} past its due date.`,
        since: inv.dueOn ?? todayIso,
        dueAt: inv.dueOn,
        action: { label: "Chase", href },
      }, { valueCents: balance, promisedToCustomer: false }, now));
    }
  }
  return items;
}

// ---- source: callback_requested (§3.3) -------------------------------------

export type CallbackEventRow = {
  id: string;
  account_id: string;
  occurred_at: string;
  payload: { phone?: string; note?: string } | null;
};

export type ContactEventRow = { account_id: string; occurred_at: string };

/** ⚑7.8 default — a callback goes overdue after this many hours. */
export const CALLBACK_OVERDUE_HOURS = 4;

/**
 * A callback form submitted, not yet called. "Called" means any logged call
 * attempt after the request — connected, no answer or message left. The item
 * dies the moment the attempt is logged, which is the derivation rule doing
 * its job.
 */
export function buildCallbackItems(
  callbacks: CallbackEventRow[],
  attempts: ContactEventRow[],
  accountNames: Map<string, string>,
  now: Date,
): WorkItem[] {
  const items: WorkItem[] = [];
  for (const cb of callbacks) {
    const answered = attempts.some((a) => a.account_id === cb.account_id && a.occurred_at > cb.occurred_at);
    if (answered) continue;
    const who = accountNames.get(cb.account_id) ?? "Someone";
    const note = cb.payload?.note;
    const phone = cb.payload?.phone;
    const due = new Date(new Date(cb.occurred_at).getTime() + CALLBACK_OVERDUE_HOURS * 3_600_000).toISOString();
    items.push(finish({
      key: itemKey("callback_requested", "event", cb.id, "call"),
      kind: "callback_requested",
      accountId: cb.account_id,
      subjectRef: { type: "event", id: cb.id },
      title: `${who} requested a call`,
      detail: [note, phone].filter(Boolean).join(" · ") || "No note with it — just the request.",
      since: cb.occurred_at,
      dueAt: due,
      action: { label: "Call", href: `/crm/customers/${cb.account_id}` },
    }, { valueCents: null, promisedToCustomer: false }, now));
  }
  return items;
}

// ---- source: approval_pending (§3.3, moved out of Campaigns per §2.4) ------

/**
 * One aggregate item, not one per message: the queue page is where they are
 * judged one by one, and ten near-identical cards here would drown the
 * customer-visible work below them. The key carries no count, so approving
 * one of three doesn't resurrect a dismissed item.
 */
export function buildApprovalItem(queuedCount: number, now: Date): WorkItem[] {
  if (queuedCount <= 0) return [];
  const n = queuedCount;
  return [finish({
    key: itemKey("approval_pending", "campaign_queue", "campaign_messages", "pending"),
    kind: "approval_pending",
    accountId: null,
    subjectRef: { type: "campaign_queue", id: "campaign_messages" },
    title: `${n} campaign message${n === 1 ? "" : "s"} waiting for approval`,
    detail: "Nothing leaves until you say so. Approval re-runs the guard chain as of that second.",
    since: now.toISOString(),
    dueAt: null,
    action: { label: n === 1 ? "Review" : "Review all", href: "/crm/campaigns/queue" },
  }, { valueCents: null, promisedToCustomer: false }, now)];
}

// ---- assembly --------------------------------------------------------------

function finish(
  partial: Omit<WorkItem, "bucket" | "priority">,
  extra: { valueCents: number | null; promisedToCustomer: boolean },
  now: Date,
): WorkItem {
  return {
    ...partial,
    bucket: bucketFor(partial.dueAt, now),
    priority: priorityOf({
      kind: partial.kind,
      valueCents: extra.valueCents,
      overdueDays: overdueDays(partial.dueAt, now),
      promisedToCustomer: extra.promisedToCustomer,
    }),
  };
}

export type Dismissal = { item_key: string; until: string | null };

/** A dismissal suppresses that exact key until `until`, or for good. A re-fire
 *  under a new discriminator is a new key and comes straight back — §3.7. */
export function applyDismissals(items: WorkItem[], dismissals: Dismissal[], now: Date): WorkItem[] {
  const active = new Set(
    dismissals.filter((d) => d.until == null || new Date(d.until) > now).map((d) => d.item_key),
  );
  return items.filter((i) => !active.has(i.key));
}

const BUCKET_ORDER: Record<WorkItemBucket, number> = { overdue: 0, today: 1, waiting: 2 };

export function sortItems(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) =>
    BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
    || b.priority - a.priority
    || a.since.localeCompare(b.since),
  );
}

export type WorkQueue = {
  items: WorkItem[];
  counts: {
    total: number;
    byBucket: Record<WorkItemBucket, number>;
    byGroup: Record<Exclude<FilterGroup, "all">, number>;
  };
};

export function assembleQueue(raw: WorkItem[], dismissals: Dismissal[], now: Date): WorkQueue {
  const items = sortItems(applyDismissals(raw, dismissals, now));
  const byBucket: WorkQueue["counts"]["byBucket"] = { overdue: 0, today: 0, waiting: 0 };
  const byGroup: WorkQueue["counts"]["byGroup"] = { messages: 0, followups: 0, approvals: 0, money: 0 };
  for (const i of items) {
    byBucket[i.bucket] += 1;
    byGroup[GROUP_OF_KIND[i.kind]] += 1;
  }
  return { items, counts: { total: items.length, byBucket, byGroup } };
}

// ---- change requests (assistant S6) ------------------------------------------

export type ChangeRequestRow = {
  id: string; estimate_id: string; created_at: string;
  payload: { text?: string; areaId?: number | null } | null;
  estimates: { account_id: string | null; title: string | null } | null;
};
export type StaffReplyRow = { estimate_id: string; created_at: string };

/** A change asked for through the assistant on a sent estimate is open until
 *  staff reply in the estimate's thread after it. One item per request. */
export function buildChangeRequestItems(rows: ChangeRequestRow[], staffReplies: StaffReplyRow[], now: Date): WorkItem[] {
  const out: WorkItem[] = [];
  for (const r of rows) {
    const answered = staffReplies.some((m) => m.estimate_id === r.estimate_id && m.created_at > r.created_at);
    if (answered) continue;
    const text = (r.payload?.text ?? "").trim();
    const dueAt = new Date(new Date(r.created_at).getTime() + 24 * 3_600_000).toISOString();
    out.push({
      key: itemKey("change_request", "estimate", r.estimate_id, r.id.slice(0, 8)),
      kind: "change_request",
      accountId: r.estimates?.account_id ?? null,
      subjectRef: { type: "estimate", id: r.estimate_id },
      title: `Change requested on ${r.estimates?.title?.trim() || "an estimate"}`,
      detail: text ? `"${text.slice(0, 140)}"` : "Asked through the assistant.",
      since: r.created_at,
      dueAt,
      bucket: bucketFor(dueAt, now),
      priority: priorityOf({ kind: "change_request", promisedToCustomer: true, overdueDays: overdueDays(dueAt, now), valueCents: null }),
      action: { label: "Reprice", href: `/quote?id=${r.estimate_id}&mode=revision` },
    });
  }
  return out;
}

// ---- live-chat handoffs (assistant S7) -------------------------------------------

export type HandoffQueueRow = {
  id: string; conversation_id: string; reason: string; status: string; requested_at: string; escalated_at: string | null; claimed_by: string | null;
  agent_conversations: { account_id: string | null; estimate_id: string | null; accounts?: { name: string | null; email: string } | null } | null;
};

/** One card per open handoff: Claim. Past the SLA it escalates — overdue,
 *  promised-to-customer priority. A claimed chat stays in the queue (the
 *  person is live) until it is resolved. */
export function buildHandoffItems(rows: HandoffQueueRow[], now: Date, slaSeconds = 180): WorkItem[] {
  return rows.filter((r) => ["requested", "claimed", "active"].includes(r.status)).map((r) => {
    const acct = r.agent_conversations?.accounts ?? null;
    const who = acct?.name?.trim() || acct?.email || "A customer";
    const dueAt = new Date(new Date(r.requested_at).getTime() + slaSeconds * 1000).toISOString();
    const live = r.status !== "requested";
    return {
      key: itemKey("handoff_requested", "thread", r.conversation_id, r.id.slice(0, 8)),
      kind: "handoff_requested",
      accountId: r.agent_conversations?.account_id ?? null,
      subjectRef: { type: "thread", id: r.conversation_id },
      title: live ? `Live chat with ${who}` : `${who} is waiting for a person`,
      detail: `${r.reason.replace(/_/g, " ")}${r.escalated_at ? " — past the SLA" : ""}`,
      since: r.requested_at,
      dueAt: live ? null : dueAt,
      // A live-chat SLA is minutes, not days: past due IS overdue, today.
      bucket: live ? "today" : new Date(dueAt).getTime() <= now.getTime() ? "overdue" : "today",
      priority: priorityOf({ kind: "handoff_requested", promisedToCustomer: true, overdueDays: r.escalated_at ? 1 : overdueDays(dueAt, now), valueCents: null }),
      action: { label: live ? "Open chat" : "Claim", href: `/crm/chat/${r.conversation_id}` },
    };
  });
}

// ---- the loader ------------------------------------------------------------

/**
 * Every read is bounded and indexed; no source may scan a table. The caps are
 * generous against today's volumes (5 accounts, 25 estimates) and the 2A.10
 * performance gate re-tests them at 25,000 accounts.
 *
 * Sources not yet feeding the registry (§5, 2A.9): message_unanswered and
 * message_unmatched wait on the inbox; visit_rebook waits on visit booking;
 * variation_pending, signoff_due, broadcast_incomplete and consent_missing
 * arrive with their modules. Each is one function plus a call here — never a
 * change to the queue itself.
 */
export async function buildWorkQueue(supabase: SupabaseClient, now = new Date()): Promise<WorkQueue> {
  const nowIso = now.toISOString();
  const since90d = new Date(now.getTime() - 90 * 86_400_000).toISOString();

  const [snoozeAcc, invoices, callbacks, queued, dismissed, changeReqs, handoffs] = await Promise.all([
    supabase.from("accounts")
      .select("id, name, email, snoozed_until, followup_due_at, followup_note")
      .or(`snoozed_until.lte.${nowIso},followup_due_at.lte.${nowIso}`)
      .limit(200),
    supabase.from("invoices")
      .select("id, estimate_id, kind, status, total_inc_cents, due_on, issued_on, estimates(account_id, accepted_name, title, job_address:sent_snapshot->>jobAddress)")
      .in("status", [...OPEN_STATUSES])
      .limit(200),
    supabase.from("crm_events")
      .select("id, account_id, occurred_at, payload")
      .eq("type", "callback_requested")
      .gte("occurred_at", since90d)
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabase.from("campaign_messages")
      .select("id", { count: "exact", head: true })
      .eq("state", "queued"),
    supabase.from("work_item_dismissals")
      .select("item_key, until")
      .or(`until.is.null,until.gt.${nowIso}`)
      .limit(500),
    supabase.from("estimate_events")
      .select("id, estimate_id, created_at, payload, estimates(account_id, title)")
      .eq("type", "change_request")
      .gte("created_at", since90d)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("agent_handoffs")
      .select("id, conversation_id, reason, status, requested_at, escalated_at, claimed_by, agent_conversations(account_id, estimate_id, accounts(name, email))")
      .in("status", ["requested", "claimed", "active"])
      .order("requested_at", { ascending: true })
      .limit(100),
  ]);
  // A change request is answered by a staff reply in that estimate's thread.
  const crRows = ((changeReqs.error ? [] : changeReqs.data) ?? []) as unknown as ChangeRequestRow[];
  const crEstimateIds = [...new Set(crRows.map((r) => r.estimate_id))];
  const { data: staffReplies } = crEstimateIds.length
    ? await supabase.from("estimate_messages").select("estimate_id, created_at").eq("direction", "staff").in("estimate_id", crEstimateIds).gte("created_at", since90d).limit(300)
    : { data: [] };

  // Callback items need the later call attempts and the names — two more
  // bounded reads, only when there are callbacks to judge.
  const cbRows = (callbacks.data ?? []) as CallbackEventRow[];
  const cbAccountIds = [...new Set(cbRows.map((c) => c.account_id))];
  const [attempts, cbAccounts] = cbAccountIds.length
    ? await Promise.all([
        supabase.from("crm_events")
          .select("account_id, occurred_at")
          .in("type", ["call_connected", "call_no_answer", "message_left"])
          .in("account_id", cbAccountIds)
          .gte("occurred_at", since90d)
          .limit(300),
        supabase.from("accounts").select("id, name, email").in("id", cbAccountIds),
      ])
    : [{ data: [] }, { data: [] }];

  // Snooze reasons live in the event log, not on the account row.
  const snoozeRows = (snoozeAcc.data ?? []) as SnoozeAccountRow[];
  const snoozedIds = snoozeRows.filter((a) => a.snoozed_until).map((a) => a.id);
  const { data: reasons } = snoozedIds.length
    ? await supabase.from("crm_events")
        .select("account_id, payload, occurred_at")
        .eq("type", "snoozed")
        .in("account_id", snoozedIds)
        .order("occurred_at", { ascending: false })
        .limit(100)
    : { data: [] };

  type InvJoin = {
    id: string; estimate_id: string; kind: string; status: string;
    total_inc_cents: number; due_on: string | null; issued_on: string | null;
    estimates: { account_id: string | null; accepted_name: string | null; title: string | null; job_address: string | null } | null;
  };
  const invRows: QueueInvoiceRow[] = ((invoices.data ?? []) as unknown as InvJoin[]).map((r) => ({
    id: r.id,
    estimateId: r.estimate_id,
    kind: r.kind as DeriveInvoice["kind"],
    status: r.status as DeriveInvoice["status"],
    totalIncCents: r.total_inc_cents,
    dueOn: r.due_on,
    issuedOn: r.issued_on,
    accountId: r.estimates?.account_id ?? null,
    customerName: r.estimates?.accepted_name ?? r.estimates?.title ?? null,
    jobAddress: r.estimates?.job_address ?? null,
  }));
  const invIds = invRows.map((r) => r.id);
  const { data: payRows } = invIds.length
    ? await supabase.from("payments")
        .select("invoice_id, amount_cents, status, paid_on")
        .in("invoice_id", invIds)
    : { data: [] };
  const payments: DerivePayment[] = ((payRows ?? []) as Array<{ invoice_id: string; amount_cents: number; status: string; paid_on: string | null }>)
    .map((p) => ({ invoiceId: p.invoice_id, amountCents: p.amount_cents, status: p.status, paidOn: p.paid_on }));

  const names = new Map(((cbAccounts.data ?? []) as Array<{ id: string; name: string | null; email: string }>)
    .map((a) => [a.id, a.name || a.email]));

  const raw = [
    ...buildSnoozeItems(snoozeRows, (reasons ?? []) as SnoozeReasonRow[], now),
    ...buildInvoiceItems(invRows, payments, now),
    ...buildCallbackItems(cbRows, (attempts.data ?? []) as ContactEventRow[], names, now),
    ...buildApprovalItem(queued.count ?? 0, now),
    ...buildChangeRequestItems(crRows, (staffReplies ?? []) as StaffReplyRow[], now),
    ...buildHandoffItems(((handoffs.error ? [] : handoffs.data) ?? []) as unknown as HandoffQueueRow[], now),
  ];

  // Until migration 20261217 runs, the dismissals table doesn't exist and the
  // read errors; the queue must still stand up (house law: inert-but-safe).
  const dismissals = (dismissed.error ? [] : (dismissed.data ?? [])) as Dismissal[];

  return assembleQueue(raw, dismissals, now);
}
