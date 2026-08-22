import { describe, expect, it } from "vitest";
import { parseBackTo } from "./backTo";

describe("the builder's back link", () => {
  it("names the job you came from", () => {
    expect(parseBackTo("/pc/wo/abc-123")).toEqual({ href: "/pc/wo/abc-123", label: "Back to the job" });
  });

  it("prefers the longer prefix", () => {
    expect(parseBackTo("/pc/schedule")?.label).toBe("Back to the schedule");
    expect(parseBackTo("/pc")?.label).toBe("Back to the dashboard");
  });

  it("keeps a query string on the way back", () => {
    expect(parseBackTo("/pc/schedule?week=3")?.href).toBe("/pc/schedule?week=3");
  });

  it("falls back to a plain label for a path it doesn't know", () => {
    expect(parseBackTo("/somewhere/else")).toEqual({ href: "/somewhere/else", label: "Back" });
  });

  it("refuses anything that could leave the site", () => {
    // Protocol-relative and absolute URLs are the open-redirect cases.
    expect(parseBackTo("//evil.example")).toBeNull();
    expect(parseBackTo("https://evil.example")).toBeNull();
    expect(parseBackTo("javascript:alert(1)")).toBeNull();
    expect(parseBackTo("/\\evil.example")).toBeNull();
    expect(parseBackTo("evil.example")).toBeNull();
  });

  it("returns null when there is no from at all", () => {
    expect(parseBackTo(undefined)).toBeNull();
    expect(parseBackTo("")).toBeNull();
  });

  it("drops a fragment and refuses an absurdly long path", () => {
    expect(parseBackTo("/pc/wo/1#top")?.href).toBe("/pc/wo/1");
    expect(parseBackTo("/" + "a".repeat(400))).toBeNull();
  });
});
