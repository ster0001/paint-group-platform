import { describe, expect, it } from "vitest";
import { accountFromToken, unsubscribeToken, unsubscribeUrl } from "./send";

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
