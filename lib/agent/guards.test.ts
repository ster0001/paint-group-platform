import { describe, expect, it } from "vitest";
import { budgetState, dollarMentions, relayRefusals, untraceableDollars } from "./guards";

describe("dollar mentions", () => {
  it("reads the ways a reply writes money", () => {
    expect(dollarMentions("between $4,100 and $5,550, deposit $ 500 and $12.50 extra")).toEqual([4100, 5550, 500, 12.5]);
  });
  it("ignores text with no figure", () => {
    expect(dollarMentions("no number here")).toEqual([]);
  });
});

describe("untraceable dollars (§2 rule 1)", () => {
  const priced = { loCents: 410_000, hiCents: 555_000, totalCents: 482_000 };
  it("a figure backed by a tool result in cents is traceable", () => {
    expect(untraceableDollars("Somewhere between $4,100 and $5,550.", [priced])).toEqual([]);
  });
  it("a figure nothing returned is caught", () => {
    expect(untraceableDollars("Call it $4,000 all up.", [priced])).toEqual([4000]);
  });
  it("tolerates the range's outward rounding by a dollar", () => {
    expect(untraceableDollars("about $4,101", [priced])).toEqual([]);
  });
  it("with no tool results at all, every figure is loose", () => {
    expect(untraceableDollars("roughly $3,000", [])).toEqual([3000]);
  });
});

describe("refusal relay (§7)", () => {
  it("appends a reason the model left out, once", () => {
    const out = relayRefusals("Sure.", ["That action is for staff.", "That action is for staff."]);
    expect(out).toBe("Sure.\n\nThat action is for staff.");
  });
  it("leaves a reply alone when the reason is already there", () => {
    const out = relayRefusals("I can't — that action is for staff.", ["that action is for staff."]);
    expect(out).toBe("I can't — that action is for staff.");
  });
});

describe("budget state (§2 rule 9)", () => {
  it("exhausts at the conversation budget", () => {
    expect(budgetState({ spent: 60_000, budget: 60_000, accountToday: 0, dailyCap: 400_000 }).exhausted).toBe(true);
    expect(budgetState({ spent: 59_999, budget: 60_000, accountToday: 0, dailyCap: 400_000 }).exhausted).toBe(false);
  });
  it("exhausts at the daily cap, and ignores the cap for anonymous conversations", () => {
    const s = budgetState({ spent: 0, budget: 60_000, accountToday: 400_000, dailyCap: 400_000 });
    expect(s.exhausted && s.which).toBe("daily");
    expect(budgetState({ spent: 0, budget: 60_000, accountToday: null, dailyCap: 1 }).exhausted).toBe(false);
  });
});
