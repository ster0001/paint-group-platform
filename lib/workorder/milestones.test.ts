import { describe, expect, it } from "vitest";
import {
  composeEndOfDay, composeMilestone, dropGreeting, groupStandings, listWords, milestonesNow, newMilestones,
  parseMilestones, unionMilestones, type GroupRowInput, type Milestone,
} from "./milestones";
import { DEFAULT_MESSAGING } from "@/lib/messaging/config";

const row = (id: string, heading: string, group: string | null, state: GroupRowInput["state"], extra: Partial<GroupRowInput> = {}): GroupRowInput =>
  ({ id, heading, group, state, ...extra });

const T = DEFAULT_MESSAGING;

// Three bedrooms: ceilings painted, walls half, skirting not started, plus a gutter line and a rectification.
const rows: GroupRowInput[] = [
  row("c1", "Bed 1", "ceilings", "done"), row("c2", "Bed 2", "ceilings", "done"), row("c3", "Bed 3", "ceilings", "done"),
  row("w1", "Bed 1", "walls", "done"), row("w2", "Bed 2", "walls", "prepped"), row("w3", "Bed 3", "walls", "prepped"),
  row("t1", "Bed 1", "trims", "todo"), row("t2", "Bed 2", "trims", "todo"),
  row("g1", "Hall", null, "todo"),
  row("r1", "Bed 1", null, "todo", { rectification: true }),
  row("s1", "Bed 3", "trims", "todo", { removed: true }),
];

describe("groupStandings", () => {
  it("one standing per group present, in the brief's order, struck rows out", () => {
    const s = groupStandings(rows);
    expect(s.map((x) => x.code)).toEqual(["ceilings", "walls", "trims"]);
    expect(s[0]).toMatchObject({ total: 3, atLeastPrepped: 3, done: 3, preppedAll: true, paintedAll: true, started: true });
    expect(s[1]).toMatchObject({ total: 3, atLeastPrepped: 3, done: 1, preppedAll: true, paintedAll: false });
    expect(s[2]).toMatchObject({ total: 2, atLeastPrepped: 0, done: 0, preppedAll: false, started: false });
  });
});

describe("milestones — which lines were crossed, and which are new", () => {
  it("a fully painted group has crossed both lines; a fully prepped one the first", () => {
    const now = milestonesNow(groupStandings(rows));
    expect(now).toEqual([
      { group: "ceilings", state: "prepped" }, { group: "ceilings", state: "done" },
      { group: "walls", state: "prepped" },
    ]);
  });

  it("announced milestones (drafted, sent or dropped) are never raised again", () => {
    const now = milestonesNow(groupStandings(rows));
    const announced: Milestone[] = [{ group: "ceilings", state: "prepped" }, { group: "ceilings", state: "done" }];
    expect(newMilestones(now, announced)).toEqual([{ group: "walls", state: "prepped" }]);
    expect(newMilestones(now, now)).toEqual([]);
  });

  it("a group completed at 100% prepped then 100% painted is two milestones (two drafts outside one window)", () => {
    const prepped = groupStandings(rows.map((r) => (r.group === "walls" ? { ...r, state: "prepped" as const } : r)));
    const first = newMilestones(milestonesNow(prepped), []);
    expect(first).toContainEqual({ group: "walls", state: "prepped" });
    const painted = groupStandings(rows.map((r) => (r.group === "walls" ? { ...r, state: "done" as const } : r)));
    const second = newMilestones(milestonesNow(painted), milestonesNow(prepped));
    expect(second).toEqual([{ group: "walls", state: "done" }]);
  });

  it("parse and union are tolerant and de-duplicating", () => {
    expect(parseMilestones([{ group: "walls", state: "prepped" }, { group: "nope", state: "done" }, null, { group: "walls", state: "later" }]))
      .toEqual([{ group: "walls", state: "prepped" }]);
    expect(unionMilestones([{ group: "walls", state: "prepped" }], [{ group: "walls", state: "prepped" }, { group: "walls", state: "done" }]))
      .toEqual([{ group: "walls", state: "prepped" }, { group: "walls", state: "done" }]);
  });
});

describe("composeMilestone — the brief's wording, from the editable templates", () => {
  const standings = groupStandings(rows);

  it("one surface prepped everywhere", () => {
    expect(composeMilestone({ firstName: "Amanda", milestones: [{ group: "trims", state: "prepped" }], standings, templates: T }))
      .toBe("Hi Amanda, all the doors, frames and skirting boards are prepped now so painting on those starts next.");
  });

  it("two surfaces prepped in one bundle", () => {
    expect(composeMilestone({ firstName: "Amanda", milestones: [{ group: "walls", state: "prepped" }, { group: "trims", state: "prepped" }], standings, templates: T }))
      .toBe("Hi Amanda, walls and doors, frames and skirting boards are both prepped now so painting on those starts next.");
  });

  it("painted right through, with the next open surface named", () => {
    expect(composeMilestone({ firstName: "Amanda", milestones: [{ group: "ceilings", state: "done" }], standings, templates: T }))
      .toBe("Hi Amanda, ceilings are painted right through the house. Walls are up next.");
  });

  it("commercial jobs say place, not house (⚑3 default)", () => {
    expect(composeMilestone({ firstName: "Raj", milestones: [{ group: "ceilings", state: "done" }], standings, templates: T, commercial: true }))
      .toContain("right through the place.");
  });

  it("the last surface painted has no next sentence", () => {
    const all = groupStandings(rows.map((r) => ({ ...r, state: "done" as const })));
    expect(composeMilestone({ firstName: "Amanda", milestones: [{ group: "trims", state: "done" }], standings: all, templates: T }))
      .toBe("Hi Amanda, doors, frames and skirting boards are painted right through the house.");
  });

  it("a group both prepped and painted in one window is said once, as painted; a painted and a prepped group are one message", () => {
    const ms: Milestone[] = [{ group: "ceilings", state: "prepped" }, { group: "ceilings", state: "done" }, { group: "walls", state: "prepped" }];
    expect(composeMilestone({ firstName: "Amanda", milestones: ms, standings, templates: T }))
      .toBe("Hi Amanda, ceilings are painted right through the house. Doors, frames and skirting boards are up next. All the walls are prepped now so painting on those starts next.");
  });

  it("nothing crossed → no message", () => {
    expect(composeMilestone({ firstName: "Amanda", milestones: [], standings, templates: T })).toBeNull();
  });

  it("helpers", () => {
    expect(listWords(["walls"])).toBe("walls");
    expect(listWords(["walls", "ceilings"])).toBe("walls and ceilings");
    expect(listWords(["a", "b", "c"])).toBe("a, b and c");
    expect(dropGreeting("Hi Amanda, all the walls are prepped.")).toBe("All the walls are prepped.");
    expect(dropGreeting("No greeting here.")).toBe("No greeting here.");
  });
});

describe("composeEndOfDay — the daily update rolled up by surface", () => {
  const standings = groupStandings(rows);

  it("a sentence per group that moved today, then tomorrow from the open groups", () => {
    const text = composeEndOfDay({ firstName: "Amanda", standings, changedToday: new Set(["c3", "w1", "w2"]), template: T.customerEndOfDayBody, photoCount: 6 });
    expect(text).toBe("Hi Amanda, quick one on today. Ceilings are all done. Walls: Bed 1 painted and Bed 2 and Bed 3 prepped ready to go. Tomorrow it’s the rest of the walls then onto the doors, frames and skirting boards. 6 new photos are on your job page.");
  });

  it("a group that did not move today is not mentioned; one open group reads as the rest of", () => {
    const text = composeEndOfDay({ firstName: "Amanda", standings, changedToday: new Set(["w2"]), template: T.customerEndOfDayBody });
    expect(text).toContain("Walls: Bed 1 painted and Bed 2 and Bed 3 prepped ready to go.");
    expect(text).not.toContain("Ceilings");
    expect(text).toContain("Tomorrow it’s the rest of the walls then onto the doors, frames and skirting boards.");
    expect(text).not.toContain("photo");
  });

  it("everything painted → no tomorrow sentence", () => {
    const all = groupStandings(rows.map((r) => ({ ...r, state: "done" as const })));
    const text = composeEndOfDay({ firstName: "Amanda", standings: all, changedToday: new Set(["t1"]), template: T.customerEndOfDayBody });
    expect(text).toBe("Hi Amanda, quick one on today. Doors, frames and skirting boards are all done.");
  });

  it("nothing grouped moved today → null, so the caller falls back to the ungrouped composer", () => {
    expect(composeEndOfDay({ firstName: "Amanda", standings, changedToday: new Set(["g1"]), template: T.customerEndOfDayBody })).toBeNull();
  });
});
