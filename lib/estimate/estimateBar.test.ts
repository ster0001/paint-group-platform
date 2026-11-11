import { describe, expect, it } from "vitest";
import { stageStrip, wizardPath } from "./estimateBar";

describe("the stage strip", () => {
  it("the main path, with everything before the current stage done", () => {
    const s = stageStrip("estimate_viewed");
    expect(s.map((x) => x.stage)).toContain("details_captured");
    expect(s.find((x) => x.state === "current")!.stage).toBe("estimate_viewed");
    expect(s.find((x) => x.stage === "estimate_sent")!.state).toBe("done");
    expect(s.find((x) => x.stage === "accepted")!.state).toBe("ahead");
    expect(s.some((x) => x.stage === "needs_help")).toBe(false);
  });
  it("an off-path stage is placed where it belongs and highlighted", () => {
    const s = stageStrip("question_asked");
    const i = s.findIndex((x) => x.stage === "question_asked");
    expect(s[i].state).toBe("current");
    expect(s[i - 1].stage).toBe("estimate_viewed");
  });
  it("no stage: everything ahead", () => {
    expect(stageStrip(null).every((x) => x.state === "ahead")).toBe(true);
  });
});

describe("the wizard path", () => {
  const ev = (type: string, step: string, at: string) => ({ type, occurred_at: at, payload: { step } });
  it("steps in first-seen order with their time; a long one is slow; an unfinished one has no time", () => {
    const p = wizardPath([
      ev("wizard_step_viewed", "what", "2026-11-01T00:00:00Z"), ev("wizard_step_completed", "what", "2026-11-01T00:00:10Z"),
      ev("wizard_step_viewed", "beds", "2026-11-01T00:00:10Z"), ev("wizard_step_completed", "beds", "2026-11-01T00:00:30Z"),
      ev("wizard_step_viewed", "rooms", "2026-11-01T00:00:30Z"), ev("wizard_step_completed", "rooms", "2026-11-01T00:05:30Z"),
      ev("wizard_step_viewed", "what", "2026-11-01T00:06:00Z"),
      ev("wizard_step_viewed", "contact", "2026-11-01T00:06:10Z"),
    ]);
    expect(p).toEqual([
      { step: "what", seconds: 10, slow: false },
      { step: "beds", seconds: 20, slow: false },
      { step: "rooms", seconds: 300, slow: true },
      { step: "contact", seconds: null, slow: false },
    ]);
  });
});
