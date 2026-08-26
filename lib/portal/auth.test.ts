import { describe, expect, it } from "vitest";
import { safeNextPath } from "./auth";

describe("safeNextPath — sign-in only ever redirects within our site", () => {
  it("defaults to /account", () => {
    expect(safeNextPath(null)).toBe("/account");
    expect(safeNextPath("")).toBe("/account");
  });
  it("keeps same-site paths", () => {
    expect(safeNextPath("/account/project")).toBe("/account/project");
    expect(safeNextPath("/e/abc123")).toBe("/e/abc123");
  });
  it("rejects absolute URLs, protocol-relative and backslash tricks", () => {
    expect(safeNextPath("https://evil.example")).toBe("/account");
    expect(safeNextPath("//evil.example")).toBe("/account");
    expect(safeNextPath("/\\evil.example")).toBe("/account");
    expect(safeNextPath("javascript:alert(1)")).toBe("/account");
  });
});
