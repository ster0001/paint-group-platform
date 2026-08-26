import { describe, expect, it } from "vitest";
import { addressKey, normaliseEmail } from "./identity";

describe("normaliseEmail — the account identity key", () => {
  it("trims and lowercases", () => {
    expect(normaliseEmail("  Margaret@Example.COM ")).toBe("margaret@example.com");
  });
  it("empty and null collapse to empty string", () => {
    expect(normaliseEmail("")).toBe("");
    expect(normaliseEmail(null)).toBe("");
    expect(normaliseEmail(undefined)).toBe("");
  });
});

describe("addressKey — the per-account property dedupe key", () => {
  it("case, punctuation and spacing never split one address into two", () => {
    const a = addressKey({ street: "2/88 Victoria Rd,", suburb: "Northcote", postcode: "3070" });
    const b = addressKey({ street: "2-88 victoria rd", suburb: " NORTHCOTE ", postcode: "3070" });
    expect(a).toBe("2 88 victoria rd northcote 3070");
    expect(b).toBe(a);
  });
  it("different unit numbers stay different properties", () => {
    const a = addressKey({ street: "2/88 Victoria Rd", suburb: "Northcote", postcode: "3070" });
    const b = addressKey({ street: "3/88 Victoria Rd", suburb: "Northcote", postcode: "3070" });
    expect(a).not.toBe(b);
  });
  it("no street means no key — a suburb alone is not an address", () => {
    expect(addressKey({ suburb: "Northcote", postcode: "3070" })).toBeNull();
    expect(addressKey({})).toBeNull();
    expect(addressKey({ street: "   " })).toBeNull();
  });
  it("missing suburb/postcode still keys on the street", () => {
    expect(addressKey({ street: "12 Acacia Street" })).toBe("12 acacia street");
  });
});
