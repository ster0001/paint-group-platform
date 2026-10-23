import { test, expect } from "vitest";
import { isMarketingHost } from "./hosts";

test("the website hosts and local dev keep the homepage; the platform host does not", () => {
  expect(isMarketingHost("new.paintgroup.com.au")).toBe(true);
  expect(isMarketingHost("paintgroup.com.au")).toBe(true);
  expect(isMarketingHost("localhost:3101")).toBe(true);
  expect(isMarketingHost("paint-group-platform.vercel.app")).toBe(false);
  expect(isMarketingHost("paint-group-platform-git-feat-x.vercel.app")).toBe(false);
  expect(isMarketingHost(null)).toBe(false);
});

test("MARKETING_HOSTS overrides the default list", () => {
  expect(isMarketingHost("staging.example.com", "staging.example.com, other.example.com")).toBe(true);
  expect(isMarketingHost("new.paintgroup.com.au", "staging.example.com")).toBe(false);
});

test("Paint Home's domain is a marketing host (its root is the homepage, never the login page)", () => {
  expect(isMarketingHost("painthome.com.au")).toBe(true);
  expect(isMarketingHost("www.painthome.com.au:443")).toBe(true);
  expect(isMarketingHost("painthome.localhost:3101")).toBe(true);
  expect(isMarketingHost("painthome.com.au", "staging.example.com")).toBe(true); // not subject to MARKETING_HOSTS
});
