import { describe, expect, it } from "vitest";
import { signState, verifyState, authorizeUrl } from "./oauth";
import { accessTokenFresh, myobStatus, type MyobConnection } from "./config";

const SECRET = "test-secret";

const conn = (over: Partial<MyobConnection> = {}): MyobConnection => ({
  refreshToken: "r",
  accessToken: "a",
  accessExpiresAt: new Date(2_000_000_000_000).toISOString(),
  companyFile: { id: "cf1", name: "Paint Group", uri: "https://api.myob.com/accountright/cf1" },
  connectedAt: "2026-08-26T00:00:00Z",
  ...over,
});

describe("myob oauth state", () => {
  it("round-trips", () => {
    const s = signState(SECRET);
    expect(verifyState(SECRET, s)).toBe(true);
  });

  it("refuses tampering, truncation and the wrong secret", () => {
    const s = signState(SECRET);
    expect(verifyState(SECRET, s.slice(0, -1) + (s.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(verifyState(SECRET, s.split(".")[0])).toBe(false);
    expect(verifyState("other-secret", s)).toBe(false);
    expect(verifyState(SECRET, null)).toBe(false);
    expect(verifyState(SECRET, "")).toBe(false);
  });

  it("authorize url carries the CompanyFile scope and the state", () => {
    const u = new URL(authorizeUrl("id-1", "https://x/api/myob/callback", "n.mac"));
    expect(u.origin).toBe("https://secure.myob.com");
    expect(u.searchParams.get("scope")).toBe("CompanyFile");
    expect(u.searchParams.get("state")).toBe("n.mac");
    expect(u.searchParams.get("redirect_uri")).toBe("https://x/api/myob/callback");
  });
});

describe("myob connection status", () => {
  it("token freshness keeps a safety margin", () => {
    const now = Date.parse("2026-08-26T10:00:00Z");
    const at = (sec: number) => conn({ accessExpiresAt: new Date(now + sec * 1000).toISOString() });
    expect(accessTokenFresh(at(300), now)).toBe(true);
    expect(accessTokenFresh(at(30), now)).toBe(false); // inside the 60s margin
    expect(accessTokenFresh(conn({ accessExpiresAt: "garbage" }), now)).toBe(false);
  });

  it("walks unconfigured → disconnected → pick business → connected", () => {
    expect(myobStatus(false, conn()).state).toBe("unconfigured");
    expect(myobStatus(true, null).state).toBe("disconnected");
    expect(myobStatus(true, conn({ companyFile: null })).state).toBe("pick_business");
    const s = myobStatus(true, conn());
    expect(s).toMatchObject({ state: "connected", businessName: "Paint Group" });
  });
});
