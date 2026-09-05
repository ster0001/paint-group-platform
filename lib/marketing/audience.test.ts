import { describe, it, expect } from "vitest";
import { audiencePrefix, entrySourceFor, otherAudienceHref, resolveAudience } from "./audience";

describe("audience resolution (session 8 §2) — hostname × path", () => {
  const D = "business.paintgroup.com.au";
  it("the commercial host is business; its root serves the business homepage route", () => {
    expect(resolveAudience(D, "/", D)).toEqual({ audience: "business", redirect: null, rewrite: "/business" });
    expect(resolveAudience(`${D}:443`, "/work/x", D)).toEqual({ audience: "business", redirect: null, rewrite: null });
    expect(resolveAudience(`www.${D}`, "/", D).audience).toBe("business");
  });
  it("/business on the residential host is business and 301s to the commercial domain, same path", () => {
    expect(resolveAudience("paintgroup.com.au", "/business", D)).toEqual({ audience: "business", redirect: `https://${D}/`, rewrite: null });
    expect(resolveAudience("www.paintgroup.com.au", "/business/work/shop-1", D)).toEqual({ audience: "business", redirect: `https://${D}/work/shop-1`, rewrite: null });
    expect(resolveAudience("localhost:3000", "/businesses", D).audience).toBe("home"); // not the prefix
  });
  it("everything else is home", () => {
    expect(resolveAudience("paintgroup.com.au", "/", D)).toEqual({ audience: "home", redirect: null, rewrite: null });
    expect(resolveAudience("paintgroup.com.au", "/work", D).audience).toBe("home");
  });
  it("with no commercial domain configured, /business is served locally (dev, C1, the Settings preview)", () => {
    expect(resolveAudience("localhost:3101", "/business", null)).toEqual({ audience: "business", redirect: null, rewrite: null });
    expect(resolveAudience("localhost:3101", "/business/work/shop-1", null)).toEqual({ audience: "business", redirect: null, rewrite: "/work/shop-1" });
    expect(resolveAudience("localhost:3101", "/", null).audience).toBe("home");
  });
  it("nav links cross domains as plain hrefs; entry sources name the audience", () => {
    expect(otherAudienceHref("home", D, "https://paintgroup.com.au")).toBe(`https://${D}/`);
    expect(otherAudienceHref("business", D, "https://paintgroup.com.au")).toBe("https://paintgroup.com.au/");
    expect(otherAudienceHref("home", null, null)).toBe("/business");
    expect(otherAudienceHref("business", null, null)).toBe("/");
    expect(audiencePrefix("business", null)).toBe("/business");
    expect(audiencePrefix("business", D)).toBe("");
    expect(entrySourceFor("business", "hero")).toBe("commercial_home_hero");
    expect(entrySourceFor("home", "bottom")).toBe("homepage_cta");
  });
});
