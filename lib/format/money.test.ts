import { describe, expect, it } from "vitest";
import { money, money0, amount, moneyAbs, moneySigned, moneyOrDash, money0OrDash } from "./money";

describe("money", () => {
  it("always shows exactly two decimals", () => {
    expect(money(123456)).toBe("$1,234.56");
    expect(money(100000)).toBe("$1,000.00");
    expect(money(5)).toBe("$0.05");
    expect(money(0)).toBe("$0.00");
  });

  // The bug A2-03 found in EstimatesTable and revisionActions: those used
  // minimumFractionDigits: 2 with no maximum, and Intl then permits a third
  // decimal. Integer cents can't produce one — but a caller passing a
  // non-integer can, and did.
  it("never renders a third decimal, even given a fractional cent", () => {
    expect(money(1234.5)).toBe("$12.35");
    expect(money(0.4)).toBe("$0.00");
  });

  it("groups thousands the Australian way", () => {
    expect(money(123456789)).toBe("$1,234,567.89");
  });

  // Every one of the 36 formatters this replaces did `"$" + value.toLocaleString()`,
  // which renders "$-1,234.56" — the sign inside the dollar sign. Wrong
  // everywhere money is written down, and it shows on credits and deductions.
  it("puts the minus OUTSIDE the dollar sign", () => {
    expect(money(-123456)).toBe("−$1,234.56");
    expect(money(-123456).startsWith("$")).toBe(false);
  });

  it("never prints a negative zero", () => {
    expect(money(-0.4)).toBe("$0.00");
    expect(money0(-40)).toBe("$0");
  });
});

describe("money0", () => {
  it("rounds to whole dollars", () => {
    expect(money0(123456)).toBe("$1,235");
    expect(money0(123444)).toBe("$1,234");
    expect(money0(50)).toBe("$1");
    expect(money0(49)).toBe("$0");
  });
});

describe("amount", () => {
  it("is money without the sign", () => {
    expect(amount(123456)).toBe("1,234.56");
  });
});

describe("moneyAbs", () => {
  it("strips the sign, both ways", () => {
    expect(moneyAbs(-123456)).toBe("$1,234.56");
    expect(moneyAbs(123456)).toBe("$1,234.56");
  });
});

describe("moneySigned", () => {
  it("marks BOTH directions — that is the difference from money()", () => {
    expect(moneySigned(-123456)).toBe("−$1,234.56");
    expect(moneySigned(123456)).toBe("+$1,234.56");
  });
  it("uses a real minus (U+2212), not a hyphen", () => {
    expect(moneySigned(-123456).startsWith("-")).toBe(false);
  });
  it("a zero delta has no direction", () => {
    expect(moneySigned(0)).toBe("$0.00");
  });
});

describe("the dash variants", () => {
  it("dash only for null and undefined — zero is a real figure", () => {
    expect(moneyOrDash(null)).toBe("—");
    expect(moneyOrDash(undefined)).toBe("—");
    expect(moneyOrDash(0)).toBe("$0.00");
    expect(money0OrDash(null)).toBe("—");
    expect(money0OrDash(0)).toBe("$0");
  });
  it("takes a custom placeholder", () => {
    expect(moneyOrDash(null, "not yet priced")).toBe("not yet priced");
  });
});
