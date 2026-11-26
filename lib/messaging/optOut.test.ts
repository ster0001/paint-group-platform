import { describe, expect, it } from "vitest";
import { SMS_OPT_OUT, unsubscribeHeaders, withEmailUnsubscribe, withSmsOptOut } from "./optOut";

describe("marketing messages carry their own way out", () => {
  it("a text gets 'Reply STOP to opt out' on the end, once", () => {
    expect(withSmsOptOut("Your range for 7 Elm St is saved: https://x.au/r — Paint Home")).toBe("Your range for 7 Elm St is saved: https://x.au/r — Paint Home. Reply STOP to opt out");
    expect(withSmsOptOut("Open it any time.  ")).toBe(`Open it any time. ${SMS_OPT_OUT}`);
    const once = withSmsOptOut("Hi Jo.");
    expect(withSmsOptOut(once)).toBe(once);
  });
  it("a writer who already said STOP is left alone", () => {
    const own = "A fresh range takes two minutes: https://x.au (Reply STOP and I won't message again.)";
    expect(withSmsOptOut(own)).toBe(own);
  });
  it("an email gets an unsubscribe line inside its body, once", () => {
    const url = "https://paintgroup.com.au/u/abc.def";
    const html = withEmailUnsubscribe("<html><body><p>Hi Jo</p></body></html>", url);
    expect(html).toMatch(/<p>Hi Jo<\/p><p [^>]*>Don't want these emails\? <a href="https:\/\/paintgroup\.com\.au\/u\/abc\.def"[^>]*>Unsubscribe<\/a>\.<\/p><\/body><\/html>$/);
    expect(withEmailUnsubscribe(html, url)).toBe(html);
    expect(withEmailUnsubscribe("<p>no body tag</p>", url)).toContain("<p>no body tag</p><p ");
  });
  it("the one-click headers mail clients read", () => {
    expect(unsubscribeHeaders("https://x.au/u/t")).toEqual({ "List-Unsubscribe": "<https://x.au/u/t>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });
});
