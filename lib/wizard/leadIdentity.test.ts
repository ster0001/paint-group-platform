import { describe, expect, it } from "vitest";
import { leadIdentityFilter } from "./leadIdentity";

describe("the wizard cap identifies a visitor by their details (Tom, 2 Nov 2026)", () => {
  it("an email identifies the visitor on its own — never also the IP", () => {
    expect(leadIdentityFilter("Tom@Example.com", "abc")).toBe("email.eq.tom@example.com");
    expect(leadIdentityFilter("Tom@Example.com", "abc")).not.toContain("ip_hash");
  });
  it("an emailless run is identified by its IP hash alone", () => {
    expect(leadIdentityFilter("", "abc")).toBe("ip_hash.eq.abc");
  });
  it("an address that could rewrite the PostgREST filter counts by IP, like an emailless run", () => {
    expect(leadIdentityFilter("a,b@example.com", "abc")).toBe("ip_hash.eq.abc");
    expect(leadIdentityFilter("a(b)@example.com", "abc")).toBe("ip_hash.eq.abc");
  });
});
