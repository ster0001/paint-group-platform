import { describe, expect, test } from "vitest";
import { mergeDraftState, sameJson } from "./draft-merge";

/**
 * C3 — what happens after a 409. The rule: server wins for confirmed fields,
 * client for unsaved edits, and a confirmation is never withdrawn by a merge.
 */

describe("the three-way rule", () => {
  test("a field I never touched takes the server's value", () => {
    const base = { title: "12 Smith St", jobType: "interior" };
    const mine = { title: "12 Smith St", jobType: "interior" };
    const theirs = { title: "12 Smith St", jobType: "both" };
    const r = mergeDraftState(base, mine, theirs);
    expect(r.state.jobType).toBe("both");
    expect(r.tookFromServer).toContain("jobType");
  });

  test("a field I AM editing keeps my value — the half-typed answer stays on screen", () => {
    const base = { title: "12 Smith" };
    const mine = { title: "12 Smith Street, Rich" };   // mid-type
    const theirs = { title: "12 Smith St" };            // the other tab saved
    const r = mergeDraftState(base, mine, theirs);
    expect(r.state.title).toBe("12 Smith Street, Rich");
    expect(r.keptMine).toContain("title");
  });

  test("both sides moved from base, independently — each keeps its own field", () => {
    const base = { a: 1, b: 1 };
    const mine = { a: 2, b: 1 };
    const theirs = { a: 1, b: 3 };
    const r = mergeDraftState(base, mine, theirs);
    expect(r.state).toEqual({ a: 2, b: 3 });
  });

  test("nested objects merge per leaf, not wholesale", () => {
    const base = { customer: { suburb: "Richmond", postcode: "3121" } };
    const mine = { customer: { suburb: "Richmond East", postcode: "3121" } };
    const theirs = { customer: { suburb: "Richmond", postcode: "3999" } };
    const r = mergeDraftState(base, mine, theirs);
    expect(r.state.customer).toEqual({ suburb: "Richmond East", postcode: "3999" });
  });
});

describe("a confirmation is never withdrawn", () => {
  test("done flags are ORed — the other tab's confirmation survives mine being false", () => {
    const base = { interiorLoop: { done: { dw: false, sweep: false } } };
    const mine = { interiorLoop: { done: { dw: false, sweep: false } } };
    const theirs = { interiorLoop: { done: { dw: true, sweep: false } } };
    const r = mergeDraftState(base, mine, theirs);
    expect((r.state.interiorLoop as { done: { dw: boolean } }).done.dw).toBe(true);
  });

  test("and mine survives theirs being false", () => {
    const base = { sidesLoop: { done: { cond: false } } };
    const mine = { sidesLoop: { done: { cond: true } } };
    const theirs = { sidesLoop: { done: { cond: false } } };
    const r = mergeDraftState(base, mine, theirs);
    expect((r.state.sidesLoop as { done: { cond: boolean } }).done.cond).toBe(true);
  });

  test("the answered flags behave the same way", () => {
    const base = { answered: { heritage: false, asbestos: false } };
    const mine = { answered: { heritage: true, asbestos: false } };
    const theirs = { answered: { heritage: false, asbestos: true } };
    const r = mergeDraftState(base, mine, theirs);
    expect(r.state.answered).toEqual({ heritage: true, asbestos: true });
  });

  test("a non-confirmation boolean is NOT ORed — it follows the ordinary rule", () => {
    const base = { noPlan: false };
    const mine = { noPlan: false };
    const theirs = { noPlan: true };
    expect(mergeDraftState(base, mine, theirs).state.noPlan).toBe(true);

    const base2 = { noPlan: true };
    const mine2 = { noPlan: false };   // I turned it off
    const theirs2 = { noPlan: true };
    expect(mergeDraftState(base2, mine2, theirs2).state.noPlan).toBe(false);
  });
});

describe("arrays are taken whole, never spliced", () => {
  test("an untouched room list takes the server's", () => {
    const base = { rooms: [{ id: 1 }] };
    const mine = { rooms: [{ id: 1 }] };
    const theirs = { rooms: [{ id: 1 }, { id: 2 }] };
    expect(mergeDraftState(base, mine, theirs).state.rooms).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("a room list I edited stays mine, entire — no element-wise splice", () => {
    const base = { rooms: [{ id: 1 }] };
    const mine = { rooms: [{ id: 1, name: "Lounge" }] };
    const theirs = { rooms: [{ id: 1 }, { id: 2 }] };
    const out = mergeDraftState(base, mine, theirs).state.rooms;
    expect(out).toEqual([{ id: 1, name: "Lounge" }]);
    expect(out).toHaveLength(1); // NOT a 2-element frankenstein neither side saw
  });
});

describe("keys only one side has", () => {
  test("a key only the server has is taken", () => {
    const r = mergeDraftState({}, {}, { planRunIds: ["a"] });
    expect(r.state.planRunIds).toEqual(["a"]);
    expect(r.tookFromServer).toContain("planRunIds");
  });
  test("a key only I have is kept — an extra answer is recoverable, a lost one is not", () => {
    const r = mergeDraftState({}, { conditionSourceIds: ["s1"] }, {});
    expect(r.state.conditionSourceIds).toEqual(["s1"]);
    expect(r.keptMine).toContain("conditionSourceIds");
  });
});

describe("nothing is silently overwritten", () => {
  test("the classic two-tab loss: my answer is NOT erased by their save", () => {
    // Tab A and Tab B both open on the same draft. B saves first. A's write
    // 409s. Before C3, A's next successful write would have erased B's answer;
    // now both survive.
    const base = { rooms: [], customer: { suburb: "" }, jobType: "interior" };
    const tabB = { rooms: [], customer: { suburb: "Richmond" }, jobType: "interior" };
    const tabA = { rooms: [], customer: { suburb: "" }, jobType: "both" };
    const r = mergeDraftState(base, tabA, tabB);
    expect((r.state.customer as { suburb: string }).suburb).toBe("Richmond"); // B's, kept
    expect(r.state.jobType).toBe("both");                                     // A's, kept
  });

  test("merging is idempotent — a second 409 against the same server copy changes nothing", () => {
    const base = { a: 1 };
    const mine = { a: 2 };
    const theirs = { a: 1, b: 9 };
    const once = mergeDraftState(base, mine, theirs).state;
    const twice = mergeDraftState(base, once, theirs).state;
    expect(twice).toEqual(once);
  });
});

describe("sameJson", () => {
  test("compares structurally, not by reference", () => {
    expect(sameJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
  });
});
