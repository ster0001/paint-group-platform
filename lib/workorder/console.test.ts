import { describe, expect, it } from "vitest";
import {
  buildQueue, headline, melbourneDate, melbourneDayStartUtc, pulseTiles, rankQueue, sparkline,
  type ConsoleInput, type QueueCard,
} from "./console";

const now = new Date("2026-08-21T09:00:00+10:00");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
// Melbourne calendar dates, not UTC ones — using toISOString() here would make
// the fixtures disagree with the code by a day for any `now` before 10am local.
const daysAhead = (d: number) => melbourneDate(new Date(now.getTime() + d * 86_400_000));

const wo = (over: Partial<ConsoleInput["workOrders"][number]> = {}) => ({
  id: "w1", woRef: "WO-3184", stage: "in_progress", title: "14 Bellair St",
  contractorName: "Marko P.", contractValueCents: 1_842_000, startDate: daysAhead(3),
  coloursConfirmed: true, blockedReason: null, acceptedAt: null, issued: true, estimateId: "e1",
  ticksDone: 18, ticksTotal: 34, ...over,
});

const base = (over: Partial<ConsoleInput> = {}): ConsoleInput => ({
  now, workOrders: [wo()], offers: [], variations: [], updates: [], signoffs: [],
  quietSites: [],
  settings: { coloursWarnDays: 5, variationCustomerSilentHours: 24 },
  ...over,
});

describe("an empty desk", () => {
  it("shows no cards when nothing is wrong", () => {
    expect(buildQueue(base())).toEqual([]);
  });

  it("says so in the headline rather than inventing urgency", () => {
    const tiles = pulseTiles(base(), [], 0);
    expect(headline(tiles)).toEqual({ top: "One job live.", bottom: "Nothing needs you." });
  });
});

describe("quality checks, updates due and walkthroughs to book (Tom, 23 Aug)", () => {
  it("says a job waiting at Quality check has checks to log", () => {
    const q = buildQueue(base({
      workOrders: [wo({ stage: "qa" })],
      qaChecks: [{ workOrderId: "w1", kind: "final", scheduledFor: null, createdAt: hoursAgo(5) }],
    }));
    expect(q.map((c) => c.key)).toContain("qa-due:w1");
    const card = q.find((c) => c.key === "qa-due:w1")!;
    expect(card.title).toBe("Quality check to do");
    expect(card.detail).toContain("1 check to log (final)");
    expect(card.action.kind).toBe("qa");
  });

  it("flags a dated mid-job check on the day, while the job is still in progress", () => {
    const q = buildQueue(base({
      qaChecks: [{ workOrderId: "w1", kind: "mid", scheduledFor: daysAhead(0), createdAt: hoursAgo(30) }],
    }));
    expect(q.find((c) => c.key === "qa-due:w1")?.title).toBe("Mid-job quality check due");
  });

  it("stays quiet about a mid-job check booked for later in the week", () => {
    const q = buildQueue(base({
      qaChecks: [{ workOrderId: "w1", kind: "mid", scheduledFor: daysAhead(2), createdAt: hoursAgo(30) }],
    }));
    expect(q.find((c) => c.key === "qa-due:w1")).toBeUndefined();
  });

  it("asks for a customer update after three quiet days in progress", () => {
    const q = buildQueue(base({
      workOrders: [wo({ startDate: daysAhead(-6) })],
      lastUpdateAt: { w1: hoursAgo(4 * 24) },
    }));
    const card = q.find((c) => c.key === "update-due:w1")!;
    expect(card.title).toBe("Customer update due");
    expect(card.action.href).toBe("/pc/updates");
  });

  it("does not nag when an update went out yesterday, or one is drafted and waiting", () => {
    expect(buildQueue(base({ workOrders: [wo({ startDate: daysAhead(-6) })], lastUpdateAt: { w1: hoursAgo(20) } }))
      .find((c) => c.key === "update-due:w1")).toBeUndefined();
    expect(buildQueue(base({
      workOrders: [wo({ startDate: daysAhead(-6) })], lastUpdateAt: { w1: hoursAgo(96) },
      updates: [{ id: "u1", workOrderId: "w1", status: "drafted", createdAt: hoursAgo(1) }],
    })).find((c) => c.key === "update-due:w1")).toBeUndefined();
  });

  it("says to ring the customer when the job is at Walkthrough with nothing booked", () => {
    const q = buildQueue(base({ workOrders: [wo({ stage: "walkthrough" })], walkthroughBooked: [] }));
    const card = q.find((c) => c.key === "contact:w1")!;
    expect(card.title).toBe("Call the customer — book the walkthrough");
    expect(card.severity).toBe("warning");
  });

  it("never asks to book a walkthrough on a 'walkthrough not required' job", () => {
    expect(buildQueue(base({ workOrders: [wo({ stage: "walkthrough", walkthroughRequired: false })] }))
      .find((c) => c.key === "contact:w1")).toBeUndefined();
  });

  it("gives an early nudge two days out from the last booked day, and none once booked", () => {
    expect(buildQueue(base({ workOrders: [wo({ endDate: daysAhead(1) })] }))
      .find((c) => c.key === "contact:w1")?.severity).toBe("info");
    expect(buildQueue(base({ workOrders: [wo({ endDate: daysAhead(1) })], walkthroughBooked: ["w1"] }))
      .find((c) => c.key === "contact:w1")).toBeUndefined();
    expect(buildQueue(base({ workOrders: [wo({ endDate: daysAhead(6) })] }))
      .find((c) => c.key === "contact:w1")).toBeUndefined();
  });
});

describe("collections from the finishing-up list (Tom, 23 Aug)", () => {
  const collection = (over: Partial<NonNullable<ConsoleInput["collections"]>[number]> = {}) => ({
    itemId: "i1", workOrderId: "w1", kind: "rubbish" as const, note: "", answeredAt: hoursAgo(3),
    woRef: "WO-3184", title: "14 Bellair St", contractorName: "Marko P.", ...over,
  });

  it("prompts the office to book a rubbish pickup", () => {
    const q = buildQueue(base({ collections: [collection()] }));
    expect(q).toHaveLength(1);
    expect(q[0].key).toBe("collect:i1");
    expect(q[0].title).toBe("Rubbish to collect");
    expect(q[0].detail).toContain("Marko P. says");
    expect(q[0].action.kind).toBe("collect");
    expect(q[0].action.label).toBe("Organised");
  });

  it("repeats the painter's equipment list on the card", () => {
    const q = buildQueue(base({ collections: [collection({ itemId: "i2", kind: "equipment", note: "2 ladders, the sprayer" })] }));
    expect(q[0].title).toBe("Equipment to collect");
    expect(q[0].detail).toContain("2 ladders, the sprayer");
  });

  it("survives the job closing — the skip still needs booking after sign-off", () => {
    const q = buildQueue(base({ workOrders: [], collections: [collection({ workOrderId: "gone" })] }));
    expect(q).toHaveLength(1);
    expect(q[0].ref).toBe("WO-3184 · 14 Bellair St");
  });

  it("is silent once organised — the loader simply stops sending it", () => {
    expect(buildQueue(base({ collections: [] }))).toEqual([]);
  });
});

describe("each trigger produces exactly one card", () => {
  it("flags an offer past its SLA as critical", () => {
    const q = buildQueue(base({
      workOrders: [wo({ stage: "offered" })],
      offers: [{ workOrderId: "w1", state: "offered", expiresAt: hoursAgo(3), contractorName: "Dean M." }],
    }));
    expect(q).toHaveLength(1);
    expect(q[0].severity).toBe("critical");
    expect(q[0].action.kind).toBe("reoffer");
  });

  it("still surfaces a job whose offer has already lapsed to expired", () => {
    // expire_booking_offers() flips a breached offer within minutes of the
    // breach. If the console only watched live offers, the card would vanish
    // before anyone saw it and the job would be quietly unassigned.
    const q = buildQueue(base({
      workOrders: [wo({ stage: "offered" })],
      offers: [{ id: "o1", workOrderId: "w1", state: "expired", expiresAt: hoursAgo(4), contractorName: "Dean M." }],
    }));
    expect(q).toHaveLength(1);
    expect(q[0].action.kind).toBe("reoffer");
  });

  it("surfaces a declined offer as nobody being on the job", () => {
    const q = buildQueue(base({
      workOrders: [wo({ stage: "offered" })],
      offers: [{ id: "o1", workOrderId: "w1", state: "declined", expiresAt: hoursAgo(2), contractorName: "Dean M." }],
    }));
    expect(q[0].title).toContain("nobody on this job");
  });

  it("drops the chase card once somebody has accepted the job", () => {
    // WO-2T625S4K, live on 22 Aug: an offer that expired five days earlier kept
    // the top of "Needs you now" saying "chase TR Painters, or release it to the
    // next contractor" — while a different contractor had accepted it and was on
    // site painting. Acceptance moves a job off `offered`; a card that survives
    // that is telling the office to undo work already underway.
    const q = buildQueue(base({
      workOrders: [wo({ stage: "in_progress" })],
      offers: [{ id: "o1", workOrderId: "w1", state: "expired", expiresAt: hoursAgo(128), contractorName: "TR Painters" }],
    }));
    expect(q.filter((c) => c.key.startsWith("offer-sla:"))).toEqual([]);
  });

  it("chases a job that has been round the houses ONCE, not once per attempt", () => {
    // Nothing downstream de-duplicates by key, so a job with several lapsed
    // offers used to stack identical cards on top of each other.
    const q = buildQueue(base({
      workOrders: [wo({ stage: "offered" })],
      offers: [
        { id: "o1", workOrderId: "w1", state: "declined", expiresAt: hoursAgo(72), contractorName: "First" },
        { id: "o2", workOrderId: "w1", state: "expired", expiresAt: hoursAgo(48), contractorName: "Second" },
        { id: "o3", workOrderId: "w1", state: "expired", expiresAt: hoursAgo(4), contractorName: "Third" },
      ],
    }));
    const sla = q.filter((c) => c.key.startsWith("offer-sla:"));
    expect(sla).toHaveLength(1);
    // The newest attempt is the one worth chasing.
    expect(sla[0].detail).toContain("Third");
  });

  it("chases a customer who accepted and has never been given a date", () => {
    // WO-VERIFY1, live on 22 Aug: accepted on the 17th, work order issued, no
    // contractor, no date — and nothing on the console mentioned it. The offer
    // cards only fire once an offer has been SENT, so a job nobody ever offered
    // was invisible unless somebody happened to scroll the tray.
    const q = buildQueue(base({
      workOrders: [wo({ stage: "offered", acceptedAt: hoursAgo(24 * 5), issued: true })],
    }));
    const card = q.find((c) => c.key === "unbooked:w1");
    expect(card).toBeDefined();
    expect(card!.title).toBe("Accepted, still not booked in");
    expect(card!.detail).toContain("5 days ago");
    expect(card!.severity).toBe("critical");
  });

  it("says yesterday rather than 1 days ago", () => {
    const q = buildQueue(base({
      workOrders: [wo({ stage: "offered", acceptedAt: hoursAgo(30), issued: true })],
    }));
    const card = q.find((c) => c.key === "unbooked:w1")!;
    expect(card.detail).toContain("yesterday");
    expect(card.severity).toBe("warning");   // not yet critical
  });

  it("gives a job accepted this morning the day's grace", () => {
    const q = buildQueue(base({
      workOrders: [wo({ stage: "offered", acceptedAt: hoursAgo(4), issued: true })],
    }));
    expect(q.filter((c) => c.key.startsWith("unbooked:"))).toEqual([]);
  });

  it("does not chase a job that already has an offer out with someone", () => {
    // The offer cards own that conversation; two cards for one job is nagging.
    const q = buildQueue(base({
      workOrders: [wo({ stage: "offered", acceptedAt: hoursAgo(24 * 5), issued: true })],
      offers: [{ id: "o1", workOrderId: "w1", state: "offered", expiresAt: hoursAgo(-6), contractorName: "Dean M." }],
    }));
    expect(q.filter((c) => c.key.startsWith("unbooked:"))).toEqual([]);
  });

  it("does not chase a job somebody is already painting", () => {
    const q = buildQueue(base({
      workOrders: [wo({ stage: "in_progress", acceptedAt: hoursAgo(24 * 30), issued: true })],
    }));
    expect(q.filter((c) => c.key.startsWith("unbooked:"))).toEqual([]);
  });

  it("asks for the work order to be issued rather than for a phone call", () => {
    const q = buildQueue(base({
      workOrders: [wo({ stage: "offered", acceptedAt: hoursAgo(24 * 2), issued: false, estimateId: "est-9" })],
    }));
    const card = q.find((c) => c.key === "unbooked:w1")!;
    expect(card.title).toContain("not issued yet");
    // Issuing happens in the BUILDER, which is keyed by estimate, not work order.
    expect(card.action.href).toContain("id=est-9");
  });

  it("ignores a job the customer never accepted", () => {
    const q = buildQueue(base({ workOrders: [wo({ stage: "offered", acceptedAt: null })] }));
    expect(q.filter((c) => c.key.startsWith("unbooked:"))).toEqual([]);
  });

  it("leaves an offer that is still inside its SLA alone", () => {
    const q = buildQueue(base({
      offers: [{ workOrderId: "w1", state: "offered", expiresAt: hoursAgo(-5), contractorName: "Dean M." }],
    }));
    expect(q).toEqual([]);
  });

  it("reminds about a quiet site rather than treating it as a crisis", () => {
    const q = buildQueue(base({ quietSites: [{ workOrderId: "w1", at: hoursAgo(14), days: 3 }] }));
    expect(q).toHaveLength(1);
    // A reminder, not a blockage: nobody expects a painter to tick daily.
    expect(q[0].severity).toBe("warning");
    expect(q[0].title).toContain("3 days");
    expect(q[0].action.kind).toBe("call");
    // And never an automated message to the customer.
    expect(q[0].detail.toLowerCase()).toContain("call");
  });

  it("flags a variation waiting on a price", () => {
    const q = buildQueue(base({
      variations: [{ id: "v1", workOrderId: "w1", status: "raised", createdAt: hoursAgo(4), pricedAt: null }],
    }));
    expect(q).toHaveLength(1);
    expect(q[0].action.kind).toBe("price");
    expect(q[0].action.href).toContain("#variation-v1");
  });

  it("only chases a silent customer once the setting's hours have passed", () => {
    const priced = (h: number) => base({
      variations: [{ id: "v1", workOrderId: "w1", status: "priced", createdAt: hoursAgo(h + 1), pricedAt: hoursAgo(h) }],
    });
    expect(buildQueue(priced(23))).toEqual([]);
    expect(buildQueue(priced(26))).toHaveLength(1);
  });

  it("flags unconfirmed colours as the start date closes in, and not before", () => {
    const colours = (days: number) => base({
      workOrders: [wo({ stage: "pre_start", coloursConfirmed: false, startDate: daysAhead(days) })],
    });
    expect(buildQueue(colours(9))).toEqual([]);
    expect(buildQueue(colours(3))).toHaveLength(1);
    expect(buildQueue(colours(3))[0].detail).toContain("Starts in 3 days");
  });

  it("says something different when the job has already started without colours", () => {
    const q = buildQueue(base({
      workOrders: [wo({ stage: "pre_start", coloursConfirmed: false, startDate: daysAhead(-2) })],
    }));
    expect(q[0].title).toContain("job has started");
  });

  it("flags a sign-off clock past 48 hours", () => {
    const q = buildQueue(base({
      signoffs: [{ workOrderId: "w1", evidencePackSentAt: hoursAgo(50), signedAt: null,
                   extensionRequestedAt: null, extensionApprovedAt: null }],
    }));
    expect(q).toHaveLength(1);
    expect(q[0].action.kind).toBe("ring");
  });

  it("does not chase a job that has been signed", () => {
    const q = buildQueue(base({
      signoffs: [{ workOrderId: "w1", evidencePackSentAt: hoursAgo(50), signedAt: hoursAgo(1),
                   extensionRequestedAt: null, extensionApprovedAt: null }],
    }));
    expect(q).toEqual([]);
  });

  it("asks about an unanswered extension INSTEAD of nagging about the clock", () => {
    const q = buildQueue(base({
      signoffs: [{ workOrderId: "w1", evidencePackSentAt: hoursAgo(50), signedAt: null,
                   extensionRequestedAt: hoursAgo(2), extensionApprovedAt: null }],
    }));
    expect(q).toHaveLength(1);      // one card per job, not two
    expect(q[0].action.kind).toBe("extension");
  });

  it("gathers drafted updates into a single card", () => {
    const q = buildQueue(base({
      updates: [
        { id: "u1", workOrderId: "w1", status: "drafted", createdAt: hoursAgo(1) },
        { id: "u2", workOrderId: "w1", status: "drafted", createdAt: hoursAgo(2) },
      ],
    }));
    expect(q).toHaveLength(1);
    expect(q[0].title).toBe("2 customer updates drafted");
    expect(q[0].severity).toBe("info");
  });

  it("ignores updates a person has already dealt with", () => {
    const q = buildQueue(base({
      updates: [{ id: "u1", workOrderId: "w1", status: "sent", createdAt: hoursAgo(1) }],
    }));
    expect(q).toEqual([]);
  });

  it("never raises a card for a job it cannot name", () => {
    const q = buildQueue(base({ quietSites: [{ workOrderId: "ghost", at: hoursAgo(2), days: 3 }] }));
    expect(q).toEqual([]);
  });
});

describe("ranking", () => {
  const card = (severity: QueueCard["severity"], ageHours: number, key: string): QueueCard => ({
    key, severity, title: key, detail: "", ref: "", workOrderId: "w1", ageHours,
    action: { label: "Go", kind: "open" },
  });

  it("puts critical first, then warning, then info", () => {
    const ranked = rankQueue([card("info", 99, "i"), card("warning", 1, "w"), card("critical", 1, "c")]);
    expect(ranked.map((c) => c.key)).toEqual(["c", "w", "i"]);
  });

  it("puts the oldest first inside a severity", () => {
    const ranked = rankQueue([card("critical", 2, "new"), card("critical", 40, "old")]);
    expect(ranked.map((c) => c.key)).toEqual(["old", "new"]);
  });

  it("is stable when two cards are the same age", () => {
    const ranked = rankQueue([card("warning", 5, "b"), card("warning", 5, "a")]);
    expect(ranked.map((c) => c.key)).toEqual(["a", "b"]);
  });
});

describe("the pulse tiles read from the same rows", () => {
  const input = base({
    workOrders: [wo(), wo({ id: "w2", woRef: "WO-3179", contractValueCents: 3_190_000 }),
                 wo({ id: "w3", stage: "closed", contractValueCents: 482_000 })],
    quietSites: [{ workOrderId: "w1", at: hoursAgo(14), days: 3 }],
    variations: [{ id: "v1", workOrderId: "w2", status: "raised", createdAt: hoursAgo(4), pricedAt: null }],
  });

  it("counts only open jobs on the books", () => {
    const tiles = pulseTiles(input, buildQueue(input), 1);
    expect(tiles.openJobs).toBe(2);
    expect(tiles.onTheBooksCents).toBe(1_842_000 + 3_190_000);   // the closed one is out
  });

  it("takes its counts straight from the queue, so they cannot disagree", () => {
    const queue = buildQueue(input);
    const tiles = pulseTiles(input, queue, 1);
    expect(tiles.critical).toBe(queue.filter((c) => c.severity === "critical").length);
    expect(tiles.waiting).toBe(queue.filter((c) => c.severity === "warning").length);
  });

  it("writes a headline that matches those counts", () => {
    const tiles = pulseTiles(input, buildQueue(input), 1);
    expect(headline(tiles)).toEqual({ top: "2 jobs live.", bottom: "2 need you before coffee." });
  });
});

describe("the sparkline", () => {
  it("returns one point per day, oldest first, zero for quiet days", () => {
    const today = melbourneDate(now);
    const yesterday = melbourneDate(new Date(now.getTime() - 86_400_000));
    const line = sparkline({ [today]: 7, [yesterday]: 3 }, now, 3);
    expect(line).toEqual([0, 3, 7]);
  });

  it("plots this morning's work on today, not yesterday", () => {
    // 9am Melbourne is still the previous day in UTC. Keyed on the UTC date,
    // today's ticks would land on yesterday's point and today would read zero.
    const morning = new Date("2026-08-21T09:00:00+10:00");
    expect(melbourneDate(morning)).toBe("2026-08-21");
    expect(morning.toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(sparkline({ "2026-08-21": 5 }, morning, 2)).toEqual([0, 5]);
  });
});

describe("the Melbourne day boundary", () => {
  it("uses the zone's real offset, not a hardcoded +10:00", () => {
    // Winter: AEST, +10. The day starts at 14:00 UTC the day before.
    const winter = new Date("2026-08-21T09:00:00+10:00");
    expect(melbourneDayStartUtc(winter)).toBe("2026-08-20T14:00:00.000Z");

    // Summer: AEDT, +11. The day starts at 13:00 UTC the day before. A
    // hardcoded +10:00 would put the window an hour out for half the year.
    const summer = new Date("2026-12-15T09:00:00+11:00");
    expect(melbourneDayStartUtc(summer)).toBe("2026-12-14T13:00:00.000Z");
  });

  it("puts a late-evening tick on the right day", () => {
    // 11pm Melbourne is already tomorrow in UTC.
    const lateEvening = new Date("2026-08-21T23:30:00+10:00");
    expect(melbourneDate(lateEvening)).toBe("2026-08-21");
    expect(lateEvening.toISOString().slice(0, 10)).toBe("2026-08-21");
    const start = new Date(melbourneDayStartUtc(lateEvening));
    expect(lateEvening.getTime()).toBeGreaterThan(start.getTime());
  });
});
