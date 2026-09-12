import { describe, expect, it } from "vitest";
import { humanLine } from "./human-line";

const base = { estimator: "Sarah Reid", notSures: 0, condition: "wear" as const, done: 0, total: 10 };

describe("C11 — one footer human line, from one evaluator (table)", () => {
  it.each([
    ["default: nothing confirmed", base, "default", "Stop whenever you like — a person picks up the rest with you."],
    ["partly done", { ...base, done: 3 }, "partly_done", "Sarah can walk it with you."],
    ["two not-sures", { ...base, notSures: 2 }, "not_sures", "Not sure? Leave it — Sarah checks it."],
    ["one not-sure is not two", { ...base, notSures: 1 }, "default", "Stop whenever you like — a person picks up the rest with you."],
    ["condition needs work", { ...base, condition: "work" as const, notSures: 5 }, "condition_work", "Rather Sarah measured it?"],
    ["all done", { ...base, done: 10, condition: "work" as const }, "all_done", "One visit, one fixed price."],
    ["all done outside", { ...base, done: 4, total: 4, exterior: true }, "all_done", "Outside always ends with a person. One visit, one fixed price."],
  ])("%s", (_n, input, state, line) => {
    const h = humanLine(input);
    expect(h.state).toBe(state);
    expect(h.line).toBe(line);
    expect(h.action).toBe("Book a visit");
  });
  it("never invents a person: no estimator record → 'we'", () => {
    expect(humanLine({ ...base, estimator: null, notSures: 2 }).line).toBe("Not sure? Leave it — We check it.");
    expect(humanLine({ ...base, estimator: "", done: 2 }).line).toBe("We can walk it with you.");
    expect(humanLine({ ...base, estimator: null, condition: "work" }).line).toBe("Rather we measured it?");
  });
  it("uses the first name only", () => {
    expect(humanLine({ ...base, estimator: "  Priya  Nair ", done: 1 }).line).toBe("Priya can walk it with you.");
  });
});
