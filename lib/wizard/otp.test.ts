import { describe, expect, it } from "vitest";
import { hashOtp, maskMobile, newOtpCode, normaliseMobile, otpIpHash, otpSmsBody } from "./otp";

describe("the gate's one-time code — the pure parts", () => {
  it("normalises an Australian mobile to ten digits, and refuses anything else", () => {
    expect(normaliseMobile("0412 345 678")).toBe("0412345678");
    expect(normaliseMobile("+61 412 345 678")).toBe("0412345678");
    expect(normaliseMobile("61412345678")).toBe("0412345678");
    expect(normaliseMobile("(04) 1234-5678")).toBe("0412345678");
    expect(normaliseMobile("03 9123 4567")).toBeNull();
    expect(normaliseMobile("0412 345 67")).toBeNull();
    expect(normaliseMobile("")).toBeNull();
  });
  it("masks the middle of the number", () => {
    expect(maskMobile("0412345678")).toBe("0412 ••• 678");
  });
  it("the text is the brief's, word for word", () => {
    expect(otpSmsBody("Paint Group", "123456")).toBe("Your Paint Group code is 123456. It expires in 10 minutes.");
    expect(otpSmsBody("Paint Home", "000001")).toBe("Your Paint Home code is 000001. It expires in 10 minutes.");
  });
  it("a code is six digits, zero-padded", () => {
    for (let i = 0; i < 50; i++) expect(newOtpCode()).toMatch(/^\d{6}$/);
  });
  it("the hash is bound to the user, the mobile and the salt — never the plain code", () => {
    const h = hashOtp("u1", "0412345678", "123456", "s");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("123456");
    expect(hashOtp("u2", "0412345678", "123456", "s")).not.toBe(h);
    expect(hashOtp("u1", "0412345679", "123456", "s")).not.toBe(h);
    expect(hashOtp("u1", "0412345678", "123457", "s")).not.toBe(h);
    expect(hashOtp("u1", "0412345678", "123456", "t")).not.toBe(h);
    expect(hashOtp("u1", "0412345678", "123456", "s")).toBe(h);
  });
  it("the IP hash is null when no proxy names an address (a loopback run), and a 32-hex key otherwise", () => {
    expect(otpIpHash(() => null)).toBeNull();
    expect(otpIpHash((n) => (n === "x-forwarded-for" ? "203.0.113.9, 10.0.0.1" : null))).toMatch(/^[0-9a-f]{32}$/);
    expect(otpIpHash((n) => (n === "x-forwarded-for" ? "203.0.113.9" : null))).toBe(otpIpHash((n) => (n === "x-forwarded-for" ? "203.0.113.9, 10.0.0.1" : null)));
  });
});
