import { describe, expect, it } from "vitest";
import { signInboundPayload, verifyInboundSignature } from "./inboundSig";

const SECRET = "whsec_" + Buffer.from("a-test-signing-key-32-bytes-long").toString("base64");
const NOW = 1_780_000_000;
const PAYLOAD = JSON.stringify({ type: "email.received", data: { subject: "Invoice" } });

describe("inbound webhook signature (svix scheme)", () => {
  it("accepts its own signature", () => {
    const h = signInboundPayload(PAYLOAD, "msg_1", NOW, SECRET);
    expect(verifyInboundSignature(PAYLOAD, h, SECRET, NOW)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const h = signInboundPayload(PAYLOAD, "msg_1", NOW, SECRET);
    expect(verifyInboundSignature(PAYLOAD + " ", h, SECRET, NOW)).toBe(false);
  });

  it("rejects a forged signature", () => {
    expect(
      verifyInboundSignature(
        PAYLOAD,
        { id: "msg_1", timestamp: String(NOW), signature: "v1,ZGVhZGJlZWY=" },
        SECRET,
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects outside the replay window", () => {
    const h = signInboundPayload(PAYLOAD, "msg_1", NOW - 301, SECRET);
    expect(verifyInboundSignature(PAYLOAD, h, SECRET, NOW)).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(
      verifyInboundSignature(PAYLOAD, { id: null, timestamp: null, signature: null }, SECRET, NOW),
    ).toBe(false);
  });

  it("accepts a multi-signature header when one matches", () => {
    const h = signInboundPayload(PAYLOAD, "msg_1", NOW, SECRET);
    const multi = { ...h, signature: `v1,AAAA ${h.signature}` };
    expect(verifyInboundSignature(PAYLOAD, multi, SECRET, NOW)).toBe(true);
  });
});
