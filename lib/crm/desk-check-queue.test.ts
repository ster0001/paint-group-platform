import { describe, expect, test } from "vitest";
import { buildDeskCheckItems, type DeskCheckRow } from "./work-queue";
import { DEFAULT_POLICY } from "@/lib/wizard/policy";

/**
 * C5 — the confirmation queue, now derived from `confirmation_requests`.
 *
 * There was NO coverage of this function before the migration: it was rewritten
 * from a jsonb marker to a table with a fully green suite, which proved nothing
 * about it. These are the behaviours the queue is actually for.
 */

const NOW = new Date("2026-09-11T09:00:00+10:00");

const row = (over: Partial<DeskCheckRow> = {}, est: Partial<NonNullable<DeskCheckRow["estimates"]>> = {}): DeskCheckRow => ({
  id: "cr-1",
  estimate_id: "est-1",
  requested_at: "2026-09-11T08:00:00+10:00",
  kind: "remote",
  status: "requested",
  suggested_action: "fix",
  assigned_to: null,
  estimates: {
    title: "12 Smith St",
    account_id: "acct-1",
    total_cents: 480_000,
    builder_state: { blocks: [{ kind: "area", type: "Interior" }] },
    ...est,
  },
  ...over,
});

describe("what lands on the queue", () => {
  test("an open request becomes one item, pointing at its desk check", () => {
    const [item] = buildDeskCheckItems([row()], DEFAULT_POLICY, NOW);
    expect(item.kind).toBe("desk_check");
    expect(item.subjectRef).toEqual({ type: "estimate", id: "est-1" });
    // C7b — the pack is a tab on the estimate, not a route of its own.
    expect(item.action?.href).toBe("/quote?id=est-1&tab=pack");
    expect(item.accountId).toBe("acct-1");
  });

  test("the key is on the ESTIMATE, not the request — a dismissal must survive a re-request", () => {
    const a = buildDeskCheckItems([row({ id: "cr-1" })], DEFAULT_POLICY, NOW)[0];
    const b = buildDeskCheckItems([row({ id: "cr-999" })], DEFAULT_POLICY, NOW)[0];
    expect(a.key).toBe(b.key);
  });

  test("an eligible interior job reads as fix-without-a-visit", () => {
    const [item] = buildDeskCheckItems([row()], DEFAULT_POLICY, NOW);
    expect(item.title).toMatch(/Fix the price without a visit/);
    expect(item.detail).toMatch(/confirmed their scope/);
  });

  test("exterior work says so, and asks for a visit instead", () => {
    const [item] = buildDeskCheckItems(
      [row({}, { builder_state: { blocks: [{ kind: "area", type: "Exterior" }] } })],
      DEFAULT_POLICY, NOW,
    );
    expect(item.title).toMatch(/book a visit/);
    expect(item.detail).toMatch(/exterior work/);
  });

  test("over the remote cap says which cap, in money", () => {
    const [item] = buildDeskCheckItems([row({}, { total_cents: 2_000_000 })], DEFAULT_POLICY, NOW);
    expect(item.title).toMatch(/book a visit/);
    expect(item.detail).toMatch(/\$12,000/);
  });

  test("a request that ASKED for a visit says so plainly, whatever the verdict", () => {
    // The promise is what the customer was told; the card must not contradict it.
    const [item] = buildDeskCheckItems([row({ kind: "visit" })], DEFAULT_POLICY, NOW);
    expect(item.title).toMatch(/book a visit/);
    expect(item.detail).toMatch(/asked for a person/);
  });
});

describe("the order — value × readiness", () => {
  test("a fixable job outranks a bigger one that needs a visit", () => {
    const items = buildDeskCheckItems([
      row({ id: "big", estimate_id: "big", suggested_action: "visit" }, { total_cents: 700_000 }),
      row({ id: "fix", estimate_id: "fix", suggested_action: "fix" }, { total_cents: 500_000 }),
    ], DEFAULT_POLICY, NOW);
    expect(items.map((i) => i.subjectRef.id)).toEqual(["fix", "big"]);
  });

  test("at equal readiness the money decides", () => {
    const items = buildDeskCheckItems([
      row({ id: "small", estimate_id: "small" }, { total_cents: 200_000 }),
      row({ id: "large", estimate_id: "large" }, { total_cents: 900_000 }),
    ], DEFAULT_POLICY, NOW);
    expect(items.map((i) => i.subjectRef.id)).toEqual(["large", "small"]);
  });

  test("a backfilled row with no suggestion sorts conservatively, never to the top", () => {
    const items = buildDeskCheckItems([
      row({ id: "backfilled", estimate_id: "backfilled", suggested_action: null }, { total_cents: 600_000 }),
      row({ id: "known", estimate_id: "known", suggested_action: "fix" }, { total_cents: 500_000 }),
    ], DEFAULT_POLICY, NOW);
    expect(items[0].subjectRef.id).toBe("known");
  });
});

describe("what it survives", () => {
  test("a missing estimate join does not drop the item or throw", () => {
    // The FK is on delete cascade, so this should not happen — but a queue that
    // throws on one bad row shows nothing at all, which is how the old one hid
    // an error for six build steps.
    const items = buildDeskCheckItems([row({ estimates: null })], DEFAULT_POLICY, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].title).toMatch(/estimate/);
  });

  test("a null total does not become zero money on the card", () => {
    const [item] = buildDeskCheckItems([row({}, { total_cents: null })], DEFAULT_POLICY, NOW);
    // valueCents feeds priority; a null total must not rank as a $0 job.
    expect(item.title).toMatch(/estimate|Smith/);
  });

  test("the request's own timestamp is what ages it, not now()", () => {
    const [item] = buildDeskCheckItems([row({ requested_at: "2026-09-01T08:00:00+10:00" })], DEFAULT_POLICY, NOW);
    expect(item.since).toBe("2026-09-01T08:00:00+10:00");
  });
});

describe("overdue against the promise we made", () => {
  const TURNAROUND = { hours: 8, words: "usually by the next working day" };
  // Requested Monday 9am; 8 business hours later is Monday 5pm.
  const MON_9 = "2026-09-14T09:00:00+10:00";

  test("due when we SAID, not on a generic next morning", () => {
    const [item] = buildDeskCheckItems(
      [row({ requested_at: MON_9 })], DEFAULT_POLICY, new Date("2026-09-14T10:00:00+10:00"), TURNAROUND,
    );
    expect(item.dueAt).toBe(new Date("2026-09-14T17:00:00+10:00").toISOString());
  });

  test("before the promise passes, the card does not nag", () => {
    const [item] = buildDeskCheckItems(
      [row({ requested_at: MON_9 })], DEFAULT_POLICY, new Date("2026-09-14T12:00:00+10:00"), TURNAROUND,
    );
    expect(item.detail).not.toMatch(/has passed/);
  });

  test("once it has, the card says so in the customer's own words", () => {
    const [item] = buildDeskCheckItems(
      [row({ requested_at: MON_9 })], DEFAULT_POLICY, new Date("2026-09-14T17:30:00+10:00"), TURNAROUND,
    );
    expect(item.detail).toMatch(/usually by the next working day — that has passed/);
  });

  test("a weekend does not make a Friday request late", () => {
    const [item] = buildDeskCheckItems(
      [row({ requested_at: "2026-09-11T16:00:00+10:00" })], DEFAULT_POLICY,
      new Date("2026-09-13T12:00:00+10:00"), TURNAROUND,
    );
    expect(item.detail).not.toMatch(/has passed/);
  });

  test("changing the setting moves BOTH the due date and the wording", () => {
    const short = { hours: 2, words: "within two hours" };
    const [item] = buildDeskCheckItems(
      [row({ requested_at: MON_9 })], DEFAULT_POLICY, new Date("2026-09-14T12:00:00+10:00"), short,
    );
    expect(item.dueAt).toBe(new Date("2026-09-14T11:00:00+10:00").toISOString());
    expect(item.detail).toMatch(/within two hours — that has passed/);
  });
});

test("C7b: the item carries what is at stake, so no surface has to fetch it again", () => {
  // The evaluator always had this number — it folds it into `priority`, which
  // is what orders the queue — and used to throw it away, forcing the
  // estimates page to re-read the same rows to print a dollar figure.
  const [item] = buildDeskCheckItems([row({}, { total_cents: 486_050 })], DEFAULT_POLICY, NOW);
  expect(item.valueCents).toBe(486_050);
});

test("C7b: a record with no figure carries null, never a misleading zero", () => {
  const [item] = buildDeskCheckItems([row({}, { total_cents: null })], DEFAULT_POLICY, NOW);
  expect(item.valueCents).toBeNull();
});
