import { test, expect } from "vitest";
import { buildDigestEmail, effectiveDigest } from "./digest";

test("⚑11 defaults: admin/approver/owner ON at 17:00, finance/viewer OFF", () => {
  expect(effectiveDigest("admin", null)).toEqual({ enabled: true, hour: 17 });
  expect(effectiveDigest("approver", null)).toEqual({ enabled: true, hour: 17 });
  expect(effectiveDigest("owner", null)).toEqual({ enabled: true, hour: 17 });
  expect(effectiveDigest("finance", null).enabled).toBe(false);
  expect(effectiveDigest("viewer", null).enabled).toBe(false);
});

test("a person's own prefs override the role default, both ways", () => {
  expect(effectiveDigest("viewer", { digest_enabled: true, digest_time: "08:00:00" }))
    .toEqual({ enabled: true, hour: 8 });
  expect(effectiveDigest("admin", { digest_enabled: false, digest_time: null }).enabled).toBe(false);
  expect(effectiveDigest("admin", { digest_enabled: null, digest_time: "07:30" }))
    .toEqual({ enabled: true, hour: 7 });
});

test("the digest email counts updates and links the workspace", () => {
  const msg = buildDigestEmail("Harbourside", [
    { address: "14 Beaumont St, Elwood", count: 3, summary: "work ticked off on site" },
    { address: "3 Tennyson St, Elwood", count: 1, summary: "" },
  ], "https://portal.example");
  expect(msg.subject).toBe("Today across your properties — 4 updates");
  expect(msg.html).toContain("14 Beaumont St, Elwood");
  expect(msg.html).toContain("https://portal.example/account");
});
