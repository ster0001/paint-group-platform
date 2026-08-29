import { describe, expect, it } from "vitest";
import {
  buildEvent,
  CRM_EVENT_TYPES,
  CRM_EVENT_SCHEMAS,
  dedupeKey,
  isCrmEventType,
  logCrmEvent,
  TYPE_NAME_SHAPE,
} from "./events";

describe("the CRM event catalogue", () => {
  it("every type name passes the shape the database enforces", () => {
    // The migration's CHECK is `^[a-z][a-z0-9_]{2,48}$`. A type that fails it
    // would be rejected by Postgres at write time, which is a bad place to
    // find out — so the catalogue is held to the same rule here.
    const bad = CRM_EVENT_TYPES.filter((t) => !TYPE_NAME_SHAPE.test(t));
    expect(bad).toEqual([]);
  });

  it("holds the vocabulary the board and campaign mockups need", () => {
    // crm-board-mockup.html: the timeline chips, the lanes' driving facts, the
    // campaign approval queue. If one of these disappears, a surface loses a
    // row it renders.
    for (const t of [
      "estimate_sent", "estimate_viewed", "estimate_accepted", "visit_booked",
      "call_no_answer", "message_left", "call_connected", "note_added",
      "temperature_set", "snoozed", "followup_set",
      "campaign_enrolled", "campaign_message_queued", "campaign_message_sent",
      "campaign_unsubscribed", "cta_clicked", "first_touch_recorded",
    ]) {
      expect(isCrmEventType(t)).toBe(true);
    }
  });

  it("refuses a type that is not in the catalogue", () => {
    expect(() => buildEvent({ type: "sneaky_event" as never })).toThrow(/Unknown CRM event type/);
  });

  it("refuses a payload that does not match its schema", () => {
    expect(() => buildEvent({ type: "note_added", payload: {} })).toThrow(/note_added/);
    expect(() => buildEvent({ type: "estimate_sent", payload: { totalCents: 1000, channel: "carrier_pigeon" } }))
      .toThrow(/estimate_sent/);
    // A negative amount is not a small mistake in a log everything reads.
    expect(() => buildEvent({ type: "invoice_paid", payload: { amountCents: -5 } })).toThrow();
  });

  it("shapes a valid event into the RPC's arguments", () => {
    const built = buildEvent({
      type: "estimate_sent",
      accountId: "acc-1",
      estimateId: "est-1",
      source: "staff",
      occurredAt: new Date("2026-08-24T01:20:00.000Z"),
      payload: { totalCents: 842000, channel: "both", validDays: 60 },
      dedupeKey: "est-1:sent",
    });
    expect(built).toEqual({
      p_type: "estimate_sent",
      p_account_id: "acc-1",
      p_payload: { totalCents: 842000, channel: "both", validDays: 60 },
      p_source: "staff",
      p_occurred_at: "2026-08-24T01:20:00.000Z",
      p_estimate_id: "est-1",
      p_work_order_id: null,
      p_invoice_id: null,
      p_property_id: null,
      p_dedupe_key: "est-1:sent",
    });
  });

  it("defaults occurred_at to null so the database stamps it, and source to system", () => {
    const built = buildEvent({ type: "note_added", payload: { body: "called back" } });
    expect(built.p_occurred_at).toBeNull();
    expect(built.p_source).toBe("system");
  });

  it("applies schema defaults rather than storing an absent field", () => {
    const built = buildEvent({ type: "call_no_answer", payload: { note: "rang twice" } });
    expect(built.p_payload).toEqual({ note: "rang twice", voicemail: false });
  });

  it("keeps a note's own time, so Friday's call lands on Friday", () => {
    const built = buildEvent({
      type: "call_no_answer",
      occurredAt: "2026-08-21T05:30:00.000Z",
      payload: { voicemail: true },
    });
    expect(built.p_occurred_at).toBe("2026-08-21T05:30:00.000Z");
  });

  it("every schema in the catalogue parses its own empty case or says why not", () => {
    // Guards against a schema that can never be satisfied — a required field
    // with no producer would break its writer the first time it ran.
    for (const type of CRM_EVENT_TYPES) {
      const r = CRM_EVENT_SCHEMAS[type].safeParse({});
      if (!r.success) {
        expect(r.error.issues.every((i) => i.path.length > 0)).toBe(true);
      }
    }
  });
});

describe("dedupeKey", () => {
  it("is stable for the same facts, whatever the casing or spacing", () => {
    expect(dedupeKey("Campaign", "Warranty Year 2", "acc-1")).toBe("campaign:warranty-year-2:acc-1");
    expect(dedupeKey("campaign", "warranty year 2", "acc-1")).toBe("campaign:warranty-year-2:acc-1");
  });

  it("drops empty parts instead of leaving holes", () => {
    expect(dedupeKey("estimate_viewed", null, "est-1", undefined, "")).toBe("estimate_viewed:est-1");
  });

  it("stays inside the column's sane length", () => {
    expect(dedupeKey("x".repeat(300)).length).toBeLessThanOrEqual(200);
  });
});

describe("logCrmEvent", () => {
  it("passes the built arguments to the RPC and returns the new id", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const db = {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: "event-1", error: null });
      },
    };
    const id = await logCrmEvent(db, { type: "note_added", accountId: "acc-1", payload: { body: "hi" } });
    expect(id).toBe("event-1");
    expect(calls[0].fn).toBe("crm_log_event");
    expect(calls[0].args.p_type).toBe("note_added");
  });

  it("returns null on a refusal rather than throwing — logging never breaks the thing it records", async () => {
    const db = { rpc: () => Promise.resolve({ data: null, error: { message: "not permitted" } }) };
    expect(await logCrmEvent(db, { type: "note_added", payload: { body: "hi" } })).toBeNull();
  });

  it("still refuses to send a malformed event at all", async () => {
    const db = { rpc: () => Promise.resolve({ data: "nope", error: null }) };
    await expect(logCrmEvent(db, { type: "note_added", payload: {} })).rejects.toThrow();
  });
});
