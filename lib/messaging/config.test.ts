import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGING, normalisePhoneAU, renderTemplate } from "./config";

describe("renderTemplate", () => {
  it("fills placeholders", () => {
    expect(renderTemplate("Hi {{first_name}}, from {{company_name}}", { first_name: "Alice", company_name: "Paint Group" }))
      .toBe("Hi Alice, from Paint Group");
  });

  it("renders missing values as empty, not the placeholder", () => {
    expect(renderTemplate("Hi {{first_name}},", {})).toBe("Hi ,");
  });

  it("tolerates spaces inside the braces", () => {
    expect(renderTemplate("{{ link }}", { link: "https://x" })).toBe("https://x");
  });

  it("default templates contain no unknown placeholders", () => {
    const known = new Set(["first_name", "name", "company_name", "estimate_title", "total", "estimator_name", "link"]);
    for (const tpl of [DEFAULT_MESSAGING.emailSubject, DEFAULT_MESSAGING.emailIntro, DEFAULT_MESSAGING.smsTemplate]) {
      for (const m of tpl.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) expect(known.has(m[1])).toBe(true);
    }
  });

  it("the SMS default carries the link", () => {
    expect(DEFAULT_MESSAGING.smsTemplate).toContain("{{link}}");
  });
});

describe("normalisePhoneAU", () => {
  it("converts a local mobile with spaces", () => {
    expect(normalisePhoneAU("0491 570 006")).toBe("+61491570006");
  });
  it("passes through E.164", () => {
    expect(normalisePhoneAU("+61422453136")).toBe("+61422453136");
  });
  it("adds + to a bare 61 number", () => {
    expect(normalisePhoneAU("61422453136")).toBe("+61422453136");
  });
  it("handles punctuation", () => {
    expect(normalisePhoneAU("(03) 8840-9414")).toBe("+61388409414");
  });
  it("rejects rubbish", () => {
    expect(normalisePhoneAU("call me")).toBeNull();
    expect(normalisePhoneAU("123")).toBeNull();
  });
});
