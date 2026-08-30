import { describe, expect, it } from "vitest";
import { gsmNormalise, renderSms, smsParts, toE164Au } from "./sms";

describe("toE164Au — numbers as people type them", () => {
  it("normalises the usual shapes", () => {
    expect(toE164Au("0455 221 908")).toBe("+61455221908");
    expect(toE164Au("+61 455 221 908")).toBe("+61455221908");
    expect(toE164Au("61455221908")).toBe("+61455221908");
    expect(toE164Au("0455-221-908")).toBe("+61455221908");
    // The dropped leading zero — a spreadsheet ate it on a real account, and
    // that account's replies could never have matched.
    expect(toE164Au("422453136")).toBe("+61422453136");
  });

  it("refuses landlines and junk rather than letting Twilio fail cryptically", () => {
    expect(toE164Au("03 8840 9414")).toBeNull();   // a landline can't take an SMS
    expect(toE164Au("8840 9414")).toBeNull();
    expect(toE164Au("")).toBeNull();
    expect(toE164Au(null)).toBeNull();
    expect(toE164Au("not a number")).toBeNull();
    expect(toE164Au("04123")).toBeNull();          // too short
  });
});

describe("smsParts — what the network will bill", () => {
  it("counts plain text against the 160/153 ladder", () => {
    expect(smsParts("")).toEqual({ chars: 0, parts: 0, unicode: false });
    expect(smsParts("a".repeat(160)).parts).toBe(1);
    expect(smsParts("a".repeat(161)).parts).toBe(2);
    expect(smsParts("a".repeat(306)).parts).toBe(2);
    expect(smsParts("a".repeat(307)).parts).toBe(3);
  });

  it("knows an emoji thirds the budget", () => {
    // One 🎨 forces UCS-2: 70 chars per single part, not 160. The counter in
    // the studio exists so nobody finds this out on the Twilio invoice.
    const r = smsParts("Fresh coat time 🎨" + "a".repeat(60));
    expect(r.unicode).toBe(true);
    expect(r.parts).toBe(2);
    expect(smsParts("plain quotes 'like this'").unicode).toBe(false);
  });
});

describe("renderSms — what actually leaves", () => {
  const links = { estimateUrl: "https://pg.au/e/tok123", accountUrl: "https://pg.au/account" };

  it("fills the per-recipient tokens, same as email", () => {
    const out = renderSms("Your estimate is ready: {{estimate}}", links);
    expect(out).toContain("https://pg.au/e/tok123");
  });

  it("falls back to the account page when nothing has been sent", () => {
    const out = renderSms("Pick up where you left off: {{estimate}}", { estimateUrl: null, accountUrl: "https://pg.au/account" });
    expect(out).toContain("https://pg.au/account");
  });

  it("always names the sender and carries the opt-out — never the writer's job", () => {
    const out = renderSms("Time to look at the outside?", links);
    expect(out.startsWith("Paint Group:")).toBe(true);
    expect(out).toMatch(/Reply STOP to opt out$/);
  });

  it("doesn't say it twice when the writer already did", () => {
    const out = renderSms("Paint Group here — reply STOP to opt out any time.", links);
    expect(out.match(/STOP/g)).toHaveLength(1);
    expect(out.startsWith("Paint Group: Paint Group")).toBe(false);
  });

  it("drops the email-only unsubscribe token instead of texting a broken link", () => {
    const out = renderSms("Bye {{unsubscribe}}", links);
    expect(out).not.toContain("{{unsubscribe}}");
    expect(out).not.toContain("undefined");
  });
});

describe("gsmNormalise — the 3× bill nobody meant to pay", () => {
  it("downgrades typographic twins and leaves meaning alone", () => {
    // Found live: an em dash in the studio's own suggested wording flipped
    // the message to UCS-2 and 183 chars became 3 texts instead of 2.
    expect(gsmNormalise("Hi — it's \u201Csaved\u201D\u2026")).toBe("Hi - it's \"saved\"...");
  });

  it("keeps an emoji — that one is a choice, not an accident", () => {
    expect(gsmNormalise("Fresh coat 🎨")).toBe("Fresh coat 🎨");
  });

  it("renderSms applies it, so the rendered message is the cheap one", () => {
    const out = renderSms("Ready — here: {{account}}", { accountUrl: "https://pg.au/account" });
    expect(smsParts(out).unicode).toBe(false);
  });
});
