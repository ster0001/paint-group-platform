import { test, expect } from "vitest";
import { gtmIdFor, PAINTHOME_GTM_ID } from "./gtm";

test("Paint Home's host gets the container", () => {
  expect(PAINTHOME_GTM_ID).toBe("GTM-MRW23TH");
  for (const host of ["painthome.com.au", "www.painthome.com.au", "painthome.localhost:3101"]) {
    expect(gtmIdFor({ host, audience: null }, undefined)).toBe("GTM-MRW23TH");
  }
});

test("the /painthome preview on a dev host gets it too", () => {
  expect(gtmIdFor({ host: "localhost:3000", audience: "painthome" }, undefined)).toBe("GTM-MRW23TH");
});

test("Paint Group gets nothing", () => {
  for (const host of ["paintgroup.com.au", "www.paintgroup.com.au", "localhost:3000"]) {
    expect(gtmIdFor({ host, audience: "home" }, undefined)).toBe("");
    expect(gtmIdFor({ host, audience: "business" }, undefined)).toBe("");
  }
});

test("the env can swap the container or switch it off; junk loads nothing", () => {
  const ph = { host: "painthome.com.au", audience: null };
  expect(gtmIdFor(ph, "GTM-ABC1234")).toBe("GTM-ABC1234");
  expect(gtmIdFor(ph, "off")).toBe("");
  expect(gtmIdFor(ph, "  ")).toBe("GTM-MRW23TH");
  expect(gtmIdFor(ph, "G-12345\"><script>")).toBe("");
});
