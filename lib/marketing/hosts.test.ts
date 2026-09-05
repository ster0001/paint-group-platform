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
