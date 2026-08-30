import { describe, expect, it } from "vitest";
import {
  classifyInbound, matchAccountsByPhone, twilioSignature, twimlReply, verifyTwilioSignature,
} from "./inboundSms";

describe("classifyInbound — the whole message, not a substring", () => {
  it("recognises the industry keywords, however typed", () => {
    for (const w of ["STOP", "stop", " Stop ", "STOPALL", "unsubscribe", "CANCEL", "End", "QUIT", "stop."]) {
      expect(classifyInbound(w)).toBe("stop");
    }
    for (const w of ["START", "unstop", "Yes"]) expect(classifyInbound(w)).toBe("start");
    for (const w of ["HELP", "info"]) expect(classifyInbound(w)).toBe("help");
  });

  it("never reads a sentence as an opt-out", () => {
    // A consent record that says something the customer didn't is the worst
    // kind of wrong. "please don't stop" must stay an ordinary reply.
    for (const s of [
      "please don't stop the great work",
      "when do you start?",
      "I need help with my quote",
      "Stop by whenever suits",
      "",
    ]) {
      expect(classifyInbound(s)).toBe("other");
    }
    expect(classifyInbound(null)).toBe("other");
  });
});

describe("the Twilio signature", () => {
  const url = "https://paintgroup.com.au/api/sms/inbound";
  const params = { From: "+61455221908", Body: "STOP", MessageSid: "SM123" };
  const token = "test-auth-token";

  it("round-trips its own signature", () => {
    const sig = twilioSignature(url, params, token);
    expect(verifyTwilioSignature(url, params, token, sig)).toBe(true);
  });

  it("sorts parameters, as Twilio does — order on the wire must not matter", () => {
    const a = twilioSignature(url, { B: "2", A: "1" }, token);
    const b = twilioSignature(url, { A: "1", B: "2" }, token);
    expect(a).toBe(b);
  });

  it("refuses a tampered body, a wrong URL, and a missing signature", () => {
    const sig = twilioSignature(url, params, token);
    expect(verifyTwilioSignature(url, { ...params, Body: "HELLO" }, token, sig)).toBe(false);
    expect(verifyTwilioSignature("https://evil.example/api/sms/inbound", params, token, sig)).toBe(false);
    expect(verifyTwilioSignature(url, params, token, null)).toBe(false);
    expect(verifyTwilioSignature(url, params, "other-token", sig)).toBe(false);
  });
});

describe("matchAccountsByPhone", () => {
  it("matches however the office typed the number, and returns every holder", () => {
    const accounts = [
      { id: "a", phone: "0455 221 908" },
      { id: "b", phone: "+61 455 221 908" },   // same mobile, second account
      { id: "c", phone: "0400 000 000" },
      { id: "d", phone: null },
      { id: "e", phone: "03 8840 9414" },      // landline never matches
    ];
    const hit = matchAccountsByPhone(accounts, "+61455221908");
    expect(hit.map((a) => a.id)).toEqual(["a", "b"]);
    expect(matchAccountsByPhone(accounts, "+61388409414")).toEqual([]);
  });
});

describe("twimlReply", () => {
  it("is XML Twilio will accept, with the message escaped", () => {
    const out = twimlReply("You're unsubscribed & won't hear from us <again>");
    expect(out).toContain("<Response><Message>");
    expect(out).toContain("&amp;");
    expect(out).toContain("&lt;again&gt;");
    expect(out).not.toContain("<again>");
  });
});
