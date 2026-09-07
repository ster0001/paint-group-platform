import { describe, expect, it } from "vitest";
import { parseTracked, trackLinks, trackedToken, trackedUrl } from "./links";

const MSG = "0b3c7c2e-1c1a-4b0e-9a3a-1d2e3f4a5b6c";

describe("tracked links", () => {
  it("round-trips a destination, and refuses a forged or edited token", () => {
    const token = trackedToken(MSG, "https://paintgroup.com.au/e/abc?x=1");
    expect(parseTracked(token)).toEqual({ messageId: MSG, url: "https://paintgroup.com.au/e/abc?x=1" });
    const [id, enc, sig] = token.split(".");
    expect(parseTracked(`${id}.${enc}.${sig.slice(0, -1)}x`)).toBeNull();
    expect(parseTracked(`${id}.${Buffer.from("https://evil.example").toString("base64url")}.${sig}`)).toBeNull();
    expect(parseTracked("junk")).toBeNull();
  });

  it("only ever redirects to a web address", () => {
    expect(parseTracked(trackedToken(MSG, "javascript:alert(1)"))).toBeNull();
  });

  it("rewrites every http link in the email but never the unsubscribe link, and is idempotent", () => {
    const html = `<a href="https://paintgroup.com.au/e/abc">Open</a> <a href="https://paintgroup.com.au/u/tok.mac">Unsubscribe</a> <a href="mailto:x@y">mail</a>`;
    const once = trackLinks(html, "https://paintgroup.com.au", MSG);
    expect(once).toContain(`href="${trackedUrl("https://paintgroup.com.au", MSG, "https://paintgroup.com.au/e/abc")}"`);
    expect(once).toContain(`href="https://paintgroup.com.au/u/tok.mac"`);
    expect(once).toContain(`href="mailto:x@y"`);
    expect(trackLinks(once, "https://paintgroup.com.au", MSG)).toBe(once);
  });
});
