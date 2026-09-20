import { describe, expect, it } from "vitest";
import { planRelease } from "./release";

const bare = { stage: "pre_start", contractor_id: null, start_date: null, hasLiveOffer: false };

describe("planRelease — mirrors import_release_to_tray", () => {
  it("releases an imported job that nobody has booked", () => {
    expect(planRelease(bare)).toBe("release");
  });
  it("leaves a job that already moved on, naming the stage", () => {
    expect(planRelease({ ...bare, stage: "offered" })).toBe("skip:offered");
    expect(planRelease({ ...bare, stage: "in_progress" })).toBe("skip:in_progress");
  });
  it("leaves a job booked by hand since the import", () => {
    expect(planRelease({ ...bare, contractor_id: "c1" })).toBe("skip:booked");
    expect(planRelease({ ...bare, start_date: "2026-10-01" })).toBe("skip:booked");
    expect(planRelease({ ...bare, hasLiveOffer: true })).toBe("skip:booked");
  });
});
