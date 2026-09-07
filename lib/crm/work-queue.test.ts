import { describe, it, expect } from "vitest";
import {
  itemKey, priorityOf, bucketFor, isCustomerVisible,
  buildSnoozeItems, buildInvoiceItems, buildCallbackItems, buildApprovalItem,
  applyDismissals, sortItems, assembleQueue,
  type WorkItem, type SnoozeAccountRow, type QueueInvoiceRow, type CallbackEventRow,
  buildLapsedItems,
  type LapsedEventRow,
  buildMessageItems,
  type InboundMessageRow,
} from "./work-queue";

/** Mid-afternoon Melbourne, mid-week. Every test pins its own clock. */
const NOW = new Date("2026-08-31T05:00:00.000Z"); // 15:00 AEST

describe("item keys (§3.4)", () => {
  it("the same fact produces the same key on every recompute", () => {
    for (let i = 0; i < 3; i++) {
      expect(itemKey("invoice_action", "invoice", "abc", "deposit")).toBe("invoice_action:invoice:abc:deposit");
    }
  });

  it("a different discriminator is a different key — dismissing one threshold must not suppress the next", () => {
    expect(itemKey("followup_due", "estimate", "e1", "quiet-4d"))
      .not.toBe(itemKey("followup_due", "estimate", "e1", "quiet-10d"));
  });
});

describe("priority (§3.6) — the two non-negotiables", () => {
  it("a promise made to a customer outranks value", () => {
    // Denise, small job, promised the breakdown — versus a big job, no commitment.
    const promised = priorityOf({ kind: "followup_due", valueCents: 0, overdueDays: 0, promisedToCustomer: true });
    const bigMoney = priorityOf({ kind: "followup_due", valueCents: 50_000_00, overdueDays: 0, promisedToCustomer: false });
    expect(promised).toBeGreaterThan(bigMoney);
  });

  it("value can never buy its way past a promise, whatever the amount", () => {
    const promised = priorityOf({ kind: "invoice_action", valueCents: null, overdueDays: 0, promisedToCustomer: true });
    const absurd = priorityOf({ kind: "invoice_action", valueCents: Number.MAX_SAFE_INTEGER, overdueDays: 0, promisedToCustomer: false });
    expect(promised).toBeGreaterThan(absurd);
  });

  it("customer-visible outranks internal at equal urgency", () => {
    // An unanswered question beats an internal approval.
    const question = priorityOf({ kind: "message_unanswered", valueCents: null, overdueDays: 1, promisedToCustomer: false });
    const approval = priorityOf({ kind: "approval_pending", valueCents: null, overdueDays: 1, promisedToCustomer: false });
    expect(question).toBeGreaterThan(approval);
    expect(isCustomerVisible("message_unanswered")).toBe(true);
    expect(isCustomerVisible("approval_pending")).toBe(false);
  });
});

describe("buckets", () => {
  it("splits on the Melbourne calendar day, not the raw timestamp", () => {
    expect(bucketFor("2026-08-30T13:00:00.000Z", NOW)).toBe("overdue"); // 30th 23:00 AEST — yesterday
    expect(bucketFor("2026-08-31T01:00:00.000Z", NOW)).toBe("today");   // 31st 11:00 AEST — earlier today stays "today", not overdue
    expect(bucketFor("2026-09-01T01:00:00.000Z", NOW)).toBe("waiting");
    expect(bucketFor(null, NOW)).toBe("today");
  });
});

describe("snooze_expired source", () => {
  const acc = (over: Partial<SnoozeAccountRow>): SnoozeAccountRow => ({
    id: "a1", name: "Grant Fowler", email: "g@x.com",
    snoozed_until: null, followup_due_at: null, followup_note: null, ...over,
  });

  it("an expired snooze fires with the recorded reason", () => {
    const items = buildSnoozeItems(
      [acc({ snoozed_until: "2026-08-30T00:00:00.000Z" })],
      [{ account_id: "a1", payload: { reason: "Deciding after their kitchen is done" }, occurred_at: "2026-08-01T00:00:00.000Z" }],
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("snooze_expired:account:a1:snooze");
    expect(items[0].detail).toContain("kitchen");
    expect(items[0].bucket).toBe("overdue");
  });

  it("a live snooze does not fire — the whole point of a snooze", () => {
    expect(buildSnoozeItems([acc({ snoozed_until: "2026-09-09T00:00:00.000Z" })], [], NOW)).toHaveLength(0);
  });

  it("a due reminder with a note counts as a promise and its own key", () => {
    const items = buildSnoozeItems(
      [acc({ followup_due_at: "2026-08-30T00:00:00.000Z", followup_note: "Send the breakdown by the 10th" })],
      [], NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("snooze_expired:account:a1:reminder");
    // The promise band: outranks an un-promised item of the same kind carrying value.
    const noPromise = buildSnoozeItems([acc({ followup_due_at: "2026-08-30T00:00:00.000Z" })], [], NOW)[0];
    expect(items[0].priority).toBeGreaterThan(noPromise.priority + 25);
  });
});

describe("invoice_action source", () => {
  const inv = (over: Partial<QueueInvoiceRow>): QueueInvoiceRow => ({
    id: "i1", estimateId: "e1", kind: "deposit", status: "issued",
    totalIncCents: 9_240_00, dueOn: null, issuedOn: "2026-08-28",
    accountId: "a1", customerName: "Karen Delaney", jobAddress: null, ...over,
  });

  it("an unpaid deposit fires and carries the balance", () => {
    const items = buildInvoiceItems([inv({})], [], NOW);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("invoice_action:invoice:i1:deposit");
    expect(items[0].detail).toContain("$9,240");
    expect(items[0].action.href).toBe("/crm/customers/a1");
  });

  it("a paid deposit is silent — replying to the fact removes the item", () => {
    const items = buildInvoiceItems([inv({})],
      [{ invoiceId: "i1", amountCents: 9_240_00, status: "succeeded", paidOn: "2026-08-30" }], NOW);
    expect(items).toHaveLength(0);
  });

  it("a non-deposit invoice only fires once overdue", () => {
    const quiet = buildInvoiceItems([inv({ kind: "final", dueOn: "2026-09-10" })], [], NOW);
    expect(quiet).toHaveLength(0);
    const late = buildInvoiceItems([inv({ kind: "final", dueOn: "2026-08-20" })], [], NOW);
    expect(late).toHaveLength(1);
    expect(late[0].key).toBe("invoice_action:invoice:i1:overdue");
  });

  it("an invoice with no account still surfaces, routed to the money page", () => {
    const items = buildInvoiceItems([inv({ accountId: null, customerName: null, jobAddress: "12 Elm St" })], [], NOW);
    expect(items[0].action.href).toBe("/invoicing/job/e1");
    expect(items[0].title).toContain("12 Elm St");
  });
});

describe("callback_requested source", () => {
  const cb: CallbackEventRow = {
    id: "ev1", account_id: "a1", occurred_at: "2026-08-30T03:00:00.000Z",
    payload: { note: "Northcote, two rooms", phone: "0412 000 000" },
  };
  const names = new Map([["a1", "Renata Alves"]]);

  it("fires until a call attempt is logged after it", () => {
    expect(buildCallbackItems([cb], [], names, NOW)).toHaveLength(1);
    expect(buildCallbackItems([cb], [{ account_id: "a1", occurred_at: "2026-08-30T05:00:00.000Z" }], names, NOW)).toHaveLength(0);
  });

  it("an attempt BEFORE the request does not count as answering it", () => {
    const items = buildCallbackItems([cb], [{ account_id: "a1", occurred_at: "2026-08-29T05:00:00.000Z" }], names, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].bucket).toBe("overdue"); // 26 hours past a 4-hour window
  });
});

describe("approval_pending source", () => {
  it("aggregates to one item with a count-free key", () => {
    const three = buildApprovalItem(3, NOW);
    const two = buildApprovalItem(2, NOW);
    expect(three).toHaveLength(1);
    expect(three[0].key).toBe(two[0].key); // approving one doesn't mint a new fact
    expect(buildApprovalItem(0, NOW)).toHaveLength(0);
  });
});

describe("dismissal (§3.7)", () => {
  const item = (key: string): WorkItem => ({
    key, kind: "followup_due", accountId: "a1", subjectRef: { type: "estimate", id: "e1" },
    title: "t", detail: "d", since: "2026-08-28T00:00:00.000Z", dueAt: null,
    bucket: "today", priority: 10, action: { label: "Open", href: "/x" },
  });

  it("suppresses the exact key, permanently or until the date", () => {
    const items = [item("k1"), item("k2")];
    expect(applyDismissals(items, [{ item_key: "k1", until: null }], NOW).map((i) => i.key)).toEqual(["k2"]);
    expect(applyDismissals(items, [{ item_key: "k1", until: "2026-09-05T00:00:00.000Z" }], NOW).map((i) => i.key)).toEqual(["k2"]);
  });

  it("an expired dismissal lets the item back in", () => {
    expect(applyDismissals([item("k1")], [{ item_key: "k1", until: "2026-08-30T00:00:00.000Z" }], NOW)).toHaveLength(1);
  });

  it("dismissing one threshold does not suppress a later, more urgent instance", () => {
    const early = item("followup_due:estimate:e1:quiet-4d");
    const later = item("followup_due:estimate:e1:quiet-10d");
    const out = applyDismissals([early, later], [{ item_key: early.key, until: null }], NOW);
    expect(out.map((i) => i.key)).toEqual([later.key]);
  });
});

describe("assembly", () => {
  it("orders overdue → today → waiting, then priority, deterministically", () => {
    const mk = (key: string, bucket: WorkItem["bucket"], priority: number): WorkItem => ({
      key, kind: "invoice_action", accountId: null, subjectRef: { type: "invoice", id: key },
      title: "t", detail: "d", since: "2026-08-28T00:00:00.000Z", dueAt: null,
      bucket, priority, action: { label: "Open", href: "/x" },
    });
    const sorted = sortItems([mk("w", "waiting", 99), mk("t-low", "today", 5), mk("t-high", "today", 50), mk("o", "overdue", 1)]);
    expect(sorted.map((i) => i.key)).toEqual(["o", "t-high", "t-low", "w"]);
  });

  it("counts per bucket and per chip group off the same list", () => {
    const q = assembleQueue([
      ...buildApprovalItem(2, NOW),
      ...buildInvoiceItems([{
        id: "i1", estimateId: "e1", kind: "deposit", status: "issued",
        totalIncCents: 100_00, dueOn: null, issuedOn: "2026-08-28",
        accountId: null, customerName: "X", jobAddress: null,
      }], [], NOW),
    ], [], NOW);
    expect(q.counts.total).toBe(2);
    expect(q.counts.byGroup.approvals).toBe(1);
    expect(q.counts.byGroup.money).toBe(1);
  });
});

describe("estimate_lapsed (CRM v2 P1, decision 8.11) — lapsed is a decision, not a loss", () => {
  const now = new Date("2026-09-07T10:00:00+10:00");
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const row = (over: Partial<LapsedEventRow> = {}): LapsedEventRow => ({
    id: "ev1", account_id: "acc1", estimate_id: "est1", occurred_at: ago(3),
    payload: { totalCents: 435_200, sentAt: ago(70) },
    estimates: { status: "expired", title: "Interior", viewed_at: null },
    ...over,
  });
  const names = new Map([["acc1", "Garry Kennedy"]]);

  it("asks a person, two days after the lapse, with the value and whether it was opened", () => {
    const [item] = buildLapsedItems([row()], [], names, now);
    expect(item.kind).toBe("estimate_lapsed");
    expect(item.title).toBe("Garry Kennedy's quote lapsed");
    expect(item.detail).toContain("$4,352");
    expect(item.detail).toContain("never opened");
    expect(item.bucket).toBe("overdue");
    expect(item.action.href).toBe("/crm/customers/acc1");
  });

  it("dies when somebody contacts the customer after the lapse", () => {
    expect(buildLapsedItems([row()], [{ account_id: "acc1", occurred_at: ago(1) }], names, now)).toHaveLength(0);
    expect(buildLapsedItems([row()], [{ account_id: "acc1", occurred_at: ago(5) }], names, now)).toHaveLength(1);
  });

  it("dies when the estimate is no longer expired (re-sent, accepted)", () => {
    expect(buildLapsedItems([row({ estimates: { status: "sent", title: null, viewed_at: null } })], [], names, now)).toHaveLength(0);
  });

  it("keys on the estimate so a re-lapse of the same quote is the same item", () => {
    const [a] = buildLapsedItems([row()], [], names, now);
    const [b] = buildLapsedItems([row({ id: "ev2", occurred_at: ago(1) })], [], names, now);
    expect(a.key).toBe(b.key);
  });
});

describe("messages (CRM v2 P3) — unanswered and unmatched", () => {
  const now = new Date("2026-09-07T10:00:00+10:00");
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const names = new Map([["acc1", "Garry Kennedy"]]);
  const inbound = (over: Partial<InboundMessageRow> = {}): InboundMessageRow => ({
    id: "m1", account_id: "acc1", channel: "email", subject: "Re: your estimate", body: "Can you do the ceilings too?",
    from_address: "garry@example.com", occurred_at: ago(6), read_at: null, ...over,
  });

  it("a customer's email with no reply is overdue after four hours, and points at the thread", () => {
    const [item] = buildMessageItems([inbound()], [], [], names, now);
    expect(item.kind).toBe("message_unanswered");
    expect(item.title).toBe("Garry Kennedy sent a email");
    expect(item.detail).toBe("Re: your estimate");
    // Due two hours ago: buckets are Melbourne DAYS, so it is "today", not yet "overdue".
    expect(item.bucket).toBe("today");
    expect(new Date(item.dueAt!).getTime()).toBe(new Date(ago(2)).getTime());
    expect(item.action.href).toBe("/crm/customers/acc1#messages");
  });

  it("dies when we wrote back after it, or rang them after it — not before", () => {
    expect(buildMessageItems([inbound()], [{ account_id: "acc1", occurred_at: ago(1) }], [], names, now)).toHaveLength(0);
    expect(buildMessageItems([inbound()], [{ account_id: "acc1", occurred_at: ago(9) }], [], names, now)).toHaveLength(1);
    expect(buildMessageItems([inbound()], [], [{ account_id: "acc1", occurred_at: ago(1) }], names, now)).toHaveLength(0);
  });

  it("a message with no customer is an attach item, never dropped", () => {
    const [item] = buildMessageItems([inbound({ account_id: null, channel: "sms", subject: null, body: "Hi is the quote still ok" })], [], [], names, now);
    expect(item.kind).toBe("message_unmatched");
    expect(item.title).toBe("A text from garry@example.com");
    expect(item.action.href).toBe("/crm/messages/m1");
    expect(item.accountId).toBeNull();
  });
});
