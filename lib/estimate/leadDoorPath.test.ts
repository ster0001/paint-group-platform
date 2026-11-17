import { describe, expect, it } from "vitest";
import { doorNextPath } from "./leadDoorPath";

describe("the lead page door's destination", () => {
  it("Tighten my range opens the quote stage; Book a visit the visit page", () => {
    expect(doorNextPath("e1", "quote", false)).toBe("/estimate/quote?id=e1");
    expect(doorNextPath("e1", "visit", false)).toBe("/estimate/visit?id=e1");
  });
  it("a bigger job has no online tightening: both go to the visit page", () => {
    expect(doorNextPath("e1", "quote", true)).toBe("/estimate/visit?id=e1");
  });
});
