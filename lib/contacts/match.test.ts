import { describe, expect, it } from "vitest";
import { contactSearchNeedle, contactSearchOr } from "./match";

describe("contactSearchNeedle", () => {
  it("is null for a blank query", () => {
    expect(contactSearchNeedle("")).toBeNull();
    expect(contactSearchNeedle("   ")).toBeNull();
  });
  it("lower-cases, caps and strips what would break the filter", () => {
    expect(contactSearchNeedle("  Zelda ")).toBe("zelda");
    expect(contactSearchNeedle("a%b_c,d(e)")).toBe("abcde");
    expect(contactSearchNeedle("x".repeat(100))).toHaveLength(80);
  });
});

describe("contactSearchOr", () => {
  it("is null for a blank query", () => {
    expect(contactSearchOr("")).toBeNull();
  });
  it("asks every text field the office searches by", () => {
    const f = contactSearchOr("Fitz")!;
    for (const col of ["first_name", "last_name", "company", "email", "city"]) {
      expect(f).toContain(`${col}.ilike.%fitz%`);
    }
    expect(f).not.toContain("phone"); // letters are never a phone search
    expect(f.split(",")).toHaveLength(5);
  });
  it("matches a phone on its digits whatever the spacing, typed or stored", () => {
    const f = contactSearchOr("0400 111")!;
    expect(f).toContain("phone_digits.ilike.%0400111%");
    expect(f).toContain("landline_digits.ilike.%0400111%");
    expect(f).not.toContain("phone.ilike");
  });
  it("never treats one or two digits as a phone search", () => {
    expect(contactSearchOr("04")).not.toContain("phone");
  });
  it("never lets a comma or bracket split the filter list", () => {
    const f = contactSearchOr("smith, (jane)")!;
    expect(f.split(",").every((p) => /^[a-z_]+\.ilike\./.test(p))).toBe(true);
  });
});
