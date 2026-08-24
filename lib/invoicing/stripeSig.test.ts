/**
 * The webhook's front door — real HMAC round-trips, tampering, and the
 * replay-tolerance window.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "./stripeSig";

const SECRET = "whsec_test_secret_for_unit_tests";
const NOW = 1_766_000_000;

function sign(payload: string, timestamp = NOW, secret = SECRET): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

describe("verifyStripeSignature", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

  it("accepts a genuine signature", () => {
    expect(verifyStripeSignature(payload, sign(payload), SECRET, NOW)).toBe(true);
  });
  it("rejects a tampered payload", () => {
    expect(verifyStripeSignature(payload + " ", sign(payload), SECRET, NOW)).toBe(false);
  });
  it("rejects the wrong secret", () => {
    expect(verifyStripeSignature(payload, sign(payload, NOW, "whsec_other"), SECRET, NOW)).toBe(false);
  });
  it("rejects a replay outside the tolerance window", () => {
    expect(verifyStripeSignature(payload, sign(payload, NOW - 301), SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(payload, sign(payload, NOW - 299), SECRET, NOW)).toBe(true);
  });
  it("rejects garbage headers and empty secrets outright", () => {
    expect(verifyStripeSignature(payload, null, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(payload, "t=,v1=", SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(payload, "nonsense", SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(payload, sign(payload), "", NOW)).toBe(false);
  });
  it("accepts when any one v1 signature matches (key-roll deliveries)", () => {
    const good = sign(payload);
    const rolled = `t=${NOW},v1=${"0".repeat(64)},${good.split(",")[1]}`;
    expect(verifyStripeSignature(payload, rolled, SECRET, NOW)).toBe(true);
  });
});
