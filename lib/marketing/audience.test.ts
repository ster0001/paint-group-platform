import { describe, it, expect } from "vitest";
import { audiencePrefix, entrySourceFor, isAudience, isPaintHomeHost, otherAudienceHref, paintHomeDomain, residentialOrigin, resolveAudience } from "./audience";

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

it("the residential origin is its own variable, never the platform address (NEXT_PUBLIC_SITE_URL)", () => {
  expect(residentialOrigin({ NEXT_SITE_URL: "https://new.paintgroup.com.au/", NEXT_PUBLIC_SITE_URL: "https://paint-group-platform.vercel.app" })).toBe("https://new.paintgroup.com.au");
  expect(residentialOrigin({ NEXT_PUBLIC_SITE_URL: "https://paint-group-platform.vercel.app" })).toBeNull();
});

describe("Paint Home (docs/briefs/paint-home.md §3) — the third audience, by hostname", () => {
  const D = "business.paintgroup.com.au";
  it("painthome.com.au and www are painthome; the root serves the Paint Home homepage route; no cookie, no env", () => {
    expect(resolveAudience("painthome.com.au", "/", D)).toEqual({ audience: "painthome", redirect: null, rewrite: "/painthome" });
    expect(resolveAudience("www.painthome.com.au:443", "/", D).audience).toBe("painthome");
    expect(resolveAudience("painthome.com.au", "/work/x", D)).toEqual({ audience: "painthome", redirect: null, rewrite: null });
    expect(resolveAudience("painthome.com.au", "/estimate", D).audience).toBe("painthome");
    // the route's own files are served where Next put them
    expect(resolveAudience("painthome.com.au", "/painthome/opengraph-image", D)).toEqual({ audience: "painthome", redirect: null, rewrite: null });
    // /painthome on the host itself has one canonical form, the root
    expect(resolveAudience("painthome.com.au", "/painthome", D)).toEqual({ audience: "painthome", redirect: "https://painthome.com.au/", rewrite: null });
    expect(paintHomeDomain(undefined)).toBe("painthome.com.au");
    expect(paintHomeDomain("https://staging.painthome.com.au/")).toBe("staging.painthome.com.au");
    expect(isPaintHomeHost("painthome.localhost:3101")).toBe(true);
    expect(isAudience("painthome")).toBe(true);
  });
  it("the Paint Group hosts are untouched: /painthome there 301s to Paint Home, everything else resolves as before", () => {
    expect(resolveAudience("paintgroup.com.au", "/", D)).toEqual({ audience: "home", redirect: null, rewrite: null });
    expect(resolveAudience("paintgroup.com.au", "/work", D).audience).toBe("home");
    expect(resolveAudience(D, "/", D).audience).toBe("business");
    expect(resolveAudience("paintgroup.com.au", "/painthome", D)).toEqual({ audience: "painthome", redirect: "https://painthome.com.au/", rewrite: null });
    expect(resolveAudience("www.paintgroup.com.au", "/painthome/work/unit-1", D)).toEqual({ audience: "painthome", redirect: "https://painthome.com.au/work/unit-1", rewrite: null });
    expect(resolveAudience("paintgroup.com.au", "/painthomes", D).audience).toBe("home"); // not the prefix
  });
  it("a dev host serves /painthome locally (the Settings preview, C1); painthome.localhost is the host form for the e2e", () => {
    expect(resolveAudience("localhost:3101", "/painthome", null)).toEqual({ audience: "painthome", redirect: null, rewrite: null });
    expect(resolveAudience("localhost:3101", "/painthome/work/unit-1", null)).toEqual({ audience: "painthome", redirect: null, rewrite: "/work/unit-1" });
    expect(resolveAudience("127.0.0.1:3000", "/painthome/icon", null)).toEqual({ audience: "painthome", redirect: null, rewrite: null });
    // Next names the built files with a hash: /painthome/icon-wk70vv, /painthome/opengraph-image-wk70vv
    expect(resolveAudience("localhost:3101", "/painthome/icon-wk70vv", null)).toEqual({ audience: "painthome", redirect: null, rewrite: null });
    expect(resolveAudience("localhost:3101", "/painthome/opengraph-image-wk70vv", null)).toEqual({ audience: "painthome", redirect: null, rewrite: null });
    expect(resolveAudience("paintgroup.com.au", "/painthome/opengraph-image-wk70vv", null)).toEqual({ audience: "painthome", redirect: "https://painthome.com.au/painthome/opengraph-image-wk70vv", rewrite: null });
    expect(resolveAudience("painthome.localhost:3101", "/", null)).toEqual({ audience: "painthome", redirect: null, rewrite: "/painthome" });
    expect(resolveAudience("business.localhost:3101", "/painthome", null).audience).toBe("painthome");
  });
  it("no cross-link, no prefix, its own entry sources", () => {
    expect(otherAudienceHref("painthome", D, "https://paintgroup.com.au")).toBe("");
    expect(audiencePrefix("painthome", null)).toBe("");
    expect(audiencePrefix("painthome", D)).toBe("");
    expect(entrySourceFor("painthome", "hero")).toBe("painthome_home_hero");
    expect(entrySourceFor("painthome", "bottom")).toBe("painthome_home_cta");
  });
});
