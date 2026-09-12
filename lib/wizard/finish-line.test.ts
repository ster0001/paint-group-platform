import { describe, expect, it } from "vitest";
import {
  NOT_INCLUDED, estimatorLine, finishOptions, handoffSteps, sendToLabel, summaryRows,
} from "./finish-line";
import type { CustomerPayload } from "./view";
import type { PaintSystemLine } from "./systems-view";

const payload = (over: Partial<CustomerPayload> = {}): CustomerPayload => ({
  outcome: "reveal", rooms: [], rangeLoCents: 940_000, rangeHiCents: 1_290_000,
  centralCents: 1_115_000, bandPct: 8, tightBand: false, accuracyPct: 82, canAccept: false,
  walkthroughRequired: true, heightUnconfirmed: false, exteriorWidthFromPlan: false,
  exteriorWidthMissing: false, confirmOnSite: [], photosPendingSignOff: false, parts: null, systems: [], estimator: null, ...over,
});

const sys = (title: string, coats: number, undercoat = false): PaintSystemLine => ({
  group: "walls", title, sentence: "", coats, undercoat, review: false,
  reason: "", crewNote: "", chips: [], flags: [],
} as unknown as PaintSystemLine);

const base = {
  payload: payload(), systems: [], access: {}, extras: [], spots: [],
  roomsConfirmed: 8, roomsTotal: 8,
};

/**
 * The ladder decides; this screen only puts it into sentences. Re-deriving
 * "can they accept?" here would be a second opinion about the same question.
 */
describe("the fixing options come from the ladder", () => {
  it("offers the fixed price only when the SERVER said they can accept", () => {
    const keys = finishOptions(payload({ canAccept: true }), "$4,860").map((o) => o.key);
    expect(keys).toContain("fix_online");
    expect(keys).not.toContain("send_for_confirmation");
  });

  it("offers to send it when they cannot", () => {
    const keys = finishOptions(payload({ canAccept: false }), "$4,860").map((o) => o.key);
    expect(keys).toContain("send_for_confirmation");
    expect(keys).not.toContain("fix_online");
  });

  it("keeps a visit on the screen either way — the doors have no hierarchy", () => {
    for (const can of [true, false]) {
      expect(finishOptions(payload({ canAccept: can }), "$4,860").map((o) => o.key)).toContain("book_visit");
    }
  });

  it("names the actual number a self-serve customer would be accepting", () => {
    const fix = finishOptions(payload({ canAccept: true }), "$4,860").find((o) => o.key === "fix_online");
    expect(fix!.body).toContain("$4,860");
    expect(fix!.body).toMatch(/60 days/);
    expect(fix!.body).toMatch(/nothing to pay now/i);
  });
});

describe("what you've told us", () => {
  it("reads the answers back, each with somewhere to change it", () => {
    const rows = summaryRows({
      ...base,
      systems: [sys("Walls", 2), sys("Ceilings", 1)],
      access: { cleared: "yes", parking: "hard" },
      extras: ["Ceiling roses"],
      spots: ["Crack", "Water mark"],
    });
    const text = rows.map((r) => r.text).join(" | ");
    expect(text).toContain("8 rooms, sizes confirmed");
    expect(text).toContain("walls 2 coats");
    expect(text).toContain("ceilings 1 coat");
    expect(text).toContain("2 spots flagged — crack and water mark");
    expect(text).toContain("Rooms cleared, tricky parking");
    for (const r of rows) expect(r.card.length).toBeGreaterThan(0);
  });

  it("leaves out rows that would say nothing", () => {
    // A summary padded with "no extras" and "no spots" teaches people to stop
    // reading it, and being read is the whole point of this screen.
    const keys = summaryRows(base).map((r) => r.key);
    expect(keys).toEqual(["rooms"]);
  });

  it("says plainly when rooms are still unconfirmed", () => {
    const rows = summaryRows({ ...base, roomsConfirmed: 5, roomsTotal: 8 });
    expect(rows[0].text).toContain("3 still to confirm");
  });

  it("marks an undercoat, because it is a coat the painter does", () => {
    const rows = summaryRows({ ...base, systems: [sys("Trims", 2, true)] });
    expect(rows[1].text).toContain("(one an undercoat)");
  });

  it("states what is not in the range, with what protects them instead", () => {
    expect(NOT_INCLUDED).toMatch(/access equipment/i);
    expect(NOT_INCLUDED).toMatch(/structural repairs/i);
    expect(NOT_INCLUDED).toMatch(/walks the job with you/i);
  });
});

describe("the hand-off steps", () => {
  it("counts what this job actually carries, not a generic reassurance", () => {
    const steps = handoffSteps({ roomsTotal: 8, spots: 3, photos: 2, turnaround: "by the next working day" });
    expect(steps).toHaveLength(3);
    expect(steps[0].body).toContain("8 rooms, 3 flagged spots and your photos");
    expect(steps[1].body).toContain("by the next working day");
  });

  it("says nothing about photos or spots when there are none", () => {
    const steps = handoffSteps({ roomsTotal: 4, spots: 0, photos: 0, turnaround: "within two working days" });
    expect(steps[0].body).toContain("4 rooms");
    expect(steps[0].body).not.toMatch(/photo|spot/i);
  });

  it("still promises a message rather than a guess", () => {
    expect(handoffSteps({ roomsTotal: 0, spots: 0, photos: 0, turnaround: "soon" })[0].body)
      .toMatch(/message rather than guess/i);
  });
});

describe("C7 · the CTA names the person who gets it", () => {
  it("uses the first name from the record", () => {
    expect(sendToLabel("Sarah Reid")).toBe("Send to Sarah");
    expect(sendToLabel("  felipe martinez ")).toBe("Send to felipe");
  });

  it("keeps the old label when there is nobody to name — never an invented one", () => {
    for (const nothing of [null, undefined, "", "   "]) {
      expect(sendToLabel(nothing)).toBe("Finalise my price");
    }
  });

  it("an initial is not a name to greet somebody with", () => {
    expect(sendToLabel("J Smith")).toBe("Finalise my price");
    expect(sendToLabel("J. Smith")).toBe("Finalise my price");
  });

  it("a one-word name is still a name", () => {
    expect(sendToLabel("Sarah")).toBe("Send to Sarah");
  });
});

describe("C7 · the hold is a setting, not a sentence in the code", () => {
  it("the door quotes the hold it was given", () => {
    const fix = finishOptions(payload({ canAccept: true }), "$4,860", "rooms", "held for 30 days")
      .find((o) => o.key === "fix_online");
    expect(fix?.body).toContain("held for 30 days");
    expect(fix?.body).toContain("$4,860");
  });

  it("and 60 days remains the default when nobody has said otherwise", () => {
    const fix = finishOptions(payload({ canAccept: true }), "$4,860").find((o) => o.key === "fix_online");
    expect(fix?.body).toContain("held for 60 days");
  });
});

describe("C7 · the hand-off says who has it, and where they work", () => {
  it("names the estimator and the customer's own suburb — not a list of postcodes", () => {
    expect(estimatorLine({ name: "Sarah Reid", suburb: "Brunswick", covers: true }))
      .toBe("Sarah looks after Brunswick, and will be the one confirming your price.");
  });

  it("drops the geography when the name came from Settings, not a patch match", () => {
    expect(estimatorLine({ name: "Sarah Reid", suburb: "Brunswick", covers: false }))
      .toBe("Sarah will be the one confirming your price.");
  });

  it("and when we know the patch but not the suburb", () => {
    expect(estimatorLine({ name: "Sarah Reid", suburb: "", covers: true }))
      .toBe("Sarah will be the one confirming your price.");
  });

  it("says nothing at all rather than introduce somebody we cannot name", () => {
    expect(estimatorLine({ name: null, suburb: "Brunswick", covers: true })).toBeNull();
    expect(estimatorLine({ name: "  ", suburb: "Brunswick", covers: true })).toBeNull();
  });
})
