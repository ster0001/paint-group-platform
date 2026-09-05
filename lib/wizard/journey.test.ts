import { describe, it, expect } from "vitest";
import { bucketFor, bucketPill, journeyFromRow, journeyLine, journeySteps, pageLabel, WIZARD_OUTCOMES } from "./journey";

const now = new Date("2026-09-06T03:00:00Z");
const mins = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

describe("bucketFor — brief §4, every combination of completed × outcome × idle", () => {
  const cases: Array<[boolean, (typeof WIZARD_OUTCOMES)[number], number, string]> = [];
  for (const completed of [false, true]) {
    for (const outcome of WIZARD_OUTCOMES) {
      for (const idle of [0, 44, 46, 600]) {
        let want: string;
        if (outcome === "call_requested") want = "ready_call";
        else if (outcome === "visit_requested") want = "ready_visit";
        else if (outcome === "question_asked" || outcome === "help_requested") want = "needs_help";
        else if (idle > 45) want = completed ? "priced_no_request" : "dropped";
        else want = "online_now";
        cases.push([completed, outcome, idle, want]);
      }
    }
  }
  it.each(cases)("completed=%s outcome=%s idle=%smin → %s", (completed, outcome, idle, want) => {
    expect(bucketFor({ completed, outcome, lastActiveAt: mins(idle), now })).toBe(want);
  });
  it("never seen = idle forever", () => {
    expect(bucketFor({ completed: false, outcome: "none", lastActiveAt: null, now })).toBe("dropped");
  });
});

describe("wording", () => {
  it("pages are named per job type; the dropped pill carries the page", () => {
    expect(pageLabel("interior", 2)).toBe("Surfaces");
    expect(pageLabel("both", 3)).toBe("Condition");
    expect(pageLabel("exterior", 2)).toBe("House");
    expect(bucketPill("dropped", "interior", 3)).toEqual({ label: "Dropped · Condition", tone: "clay" });
    expect(bucketPill("ready_visit", null, 6).label).toBe("Ready · visit");
    expect(bucketPill("online_now", null, 1).label).toBe("Online now"); // never "In progress"
  });
  it("the mono line reads 'x of y · time · last active'", () => {
    expect(journeyLine({ furthestPage: 3, pagesTotal: 6, activeSeconds: 540, lastActiveAt: mins(120) }, now)).toBe("3 of 6 · 9 min · last active 2h ago");
    expect(journeyLine({ furthestPage: 1, pagesTotal: 6, activeSeconds: 30, lastActiveAt: mins(0) }, now)).toBe("1 of 6 · <1 min · last active just now");
  });
  it("a pre-migration row still reads, and the steps sum to the seconds", () => {
    const j = journeyFromRow({ id: "d1", job_type: "interior", step_times: { "1": 30, "2": 90, junk: "x" }, furthest_page: 2, active_seconds: 120 });
    expect(j.bucket).toBe("online_now");
    expect(j.outcome).toBe("none");
    const steps = journeySteps(j);
    expect(steps.length).toBe(6);
    expect(steps.reduce((s, x) => s + x.seconds, 0)).toBe(j.activeSeconds);
    expect(steps[1]).toMatchObject({ label: "Surfaces", seconds: 90, reached: true });
    expect(steps[2].reached).toBe(false);
  });
});
