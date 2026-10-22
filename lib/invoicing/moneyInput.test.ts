import { describe, expect, it } from "vitest";
import { centsOf, dollarsText, gstOnExCents } from "./moneyInput";

describe("typed money on the Payments page", () => {
  it("dollars text ⇄ cents", () => {
    expect(dollarsText(123450)).toBe("1234.50");
    expect(centsOf("1,234.50")).toBe(123450);
    expect(centsOf("$40")).toBe(4000);
    expect(centsOf("-5")).toBeNull();
    expect(centsOf("abc")).toBeNull();
  });
  it("GST on an ex-GST figure is 10% to the cent", () => {
    expect(gstOnExCents(123450)).toBe(12345);
    expect(gstOnExCents(5)).toBe(1);
  });
});
