import { describe, expect, it } from "vitest";
import { accountFromToken, fillLinkTokens, unsubscribeToken, unsubscribeUrl } from "./send";

const ACCOUNT = "268fc431-7732-4092-91d9-fc50d1a58081";

describe("the unsubscribe link", () => {
  it("round-trips the account it was made for", () => {
    expect(accountFromToken(unsubscribeToken(ACCOUNT))).toBe(ACCOUNT);
  });

  it("refuses a token someone edited", () => {
    // The attack it exists to stop: change the id in the URL, unsubscribe
    // somebody else. The signature is over the id, so it stops being valid.
    const token = unsubscribeToken(ACCOUNT);
    const other = "11111111-1111-1111-1111-111111111111";
    const forged = `${other}.${token.split(".")[1]}`;
    expect(accountFromToken(forged)).toBeNull();
  });

  it("refuses junk without throwing", () => {
    for (const junk of ["", "nonsense", "a.b", ".", "..", `${ACCOUNT}.`, `.${ACCOUNT}`]) {
      expect(accountFromToken(junk)).toBeNull();
    }
  });

  it("is stable, so a link in an old email still works", () => {
    // Emails outlive deploys. A token that changed per send would leave every
    // previously delivered unsubscribe link dead — which is worse than useless,
    // it is a complaint waiting to happen.
    expect(unsubscribeToken(ACCOUNT)).toBe(unsubscribeToken(ACCOUNT));
  });

  it("builds an absolute URL", () => {
    const url = unsubscribeUrl(ACCOUNT, "https://paintgroup.com.au/");
    expect(url.startsWith("https://paintgroup.com.au/u/")).toBe(true);
    expect(url).not.toContain("//u/");
  });
});

describe("the per-recipient button links", () => {
  const urls = {
    unsubscribe: "https://pg.au/u/tok",
    accountUrl: "https://pg.au/account",
    estimateUrl: "https://pg.au/e/abc123",
  };

  it("sends {{estimate}} to the bare estimate and {{estimate_in_account}} into the portal", () => {
    // Tom, 11 Sep: a button can now land them on the estimate INSIDE their
    // account — the same document, with the way back to their other jobs.
    const fill = fillLinkTokens(urls);
    expect(fill('href="{{estimate}}"')).toBe('href="https://pg.au/e/abc123"');
    expect(fill('href="{{estimate_in_account}}"')).toBe('href="https://pg.au/e/abc123?portal=1"');
    expect(fill('href="{{account}}"')).toBe('href="https://pg.au/account"');
    expect(fill("{{unsubscribe}}")).toBe("https://pg.au/u/tok");
  });

  it("keeps the longer token whole — {{estimate}} must not eat its prefix", () => {
    // Substitution order is the trap: replace {{estimate}} first and
    // {{estimate_in_account}} would survive as a half-filled string.
    const out = fillLinkTokens(urls)("a {{estimate_in_account}} b {{estimate}} c");
    expect(out).toBe("a https://pg.au/e/abc123?portal=1 b https://pg.au/e/abc123 c");
    expect(out).not.toContain("{{");
  });

  it("a query already on the link gets an &, not a second ?", () => {
    const fill = fillLinkTokens({ ...urls, estimateUrl: "https://pg.au/e/abc123?ref=sms" });
    expect(fill("{{estimate_in_account}}")).toBe("https://pg.au/e/abc123?ref=sms&portal=1");
  });

  it("nothing sent yet: both estimate tokens land on the account page, unflagged", () => {
    const fill = fillLinkTokens({ ...urls, estimateUrl: null });
    expect(fill("{{estimate}}")).toBe("https://pg.au/account");
    // ?portal=1 on the account page itself would mean nothing.
    expect(fill("{{estimate_in_account}}")).toBe("https://pg.au/account");
  });
});
