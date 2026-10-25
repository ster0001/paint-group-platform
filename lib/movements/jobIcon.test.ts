import { describe, expect, it } from "vitest";
import { jobAttention, tierOfKind } from "./jobIcon";

describe("the job icon ladder (Tom, 25 Oct 2026)", () => {
  it("nothing open: teal house; closed with nothing open: grey gear", () => {
    expect(jobAttention([], [], false)).toEqual({ tier: "none", icon: "house", lines: [], count: 0 });
    expect(jobAttention([], [], true)).toMatchObject({ tier: "closed", icon: "gear", count: 0 });
  });
  it("a need alone is the move rung with the need icon; a call outranks it; a problem outranks a call", () => {
    expect(jobAttention([], ["paint to plan"], false)).toMatchObject({ tier: "move", icon: "need", count: 1 });
    const call = jobAttention([{ kind: "job_checkin", title: "Check in with Priya" }], ["paint to plan"], false);
    expect(call).toMatchObject({ tier: "call", icon: "phone", count: 2 });
    expect(call.lines.map((l) => l.label)).toEqual(["Check in with Priya", "paint to plan"]);
    const problem = jobAttention([{ kind: "job_checkin", title: "Check in" }, { kind: "movement_overdue", title: "Paint pickup overdue" }], [], false);
    expect(problem).toMatchObject({ tier: "problem", icon: "warning" });
    expect(problem.lines[0].label).toBe("Paint pickup overdue");
  });
  it("a visit outranks a need but not a call; the ladder order is problem → call → visit → move", () => {
    expect(jobAttention([{ kind: "qa_check_due", title: "Quality check due" }], ["gear to plan"], false)).toMatchObject({ tier: "visit", icon: "clipboard" });
    expect(jobAttention([{ kind: "qa_check_due", title: "QC" }, { kind: "callback_visit_soon", title: "Call back visit" }], [], false)).toMatchObject({ tier: "call" });
    expect(["movement_problem", "payment_hold", "walkthrough_flagged", "callback_unbooked"].map(tierOfKind)).toEqual(["problem", "problem", "problem", "problem"]);
    expect(["job_followup", "delivery_unconfirmed"].map(tierOfKind)).toEqual(["call", "call"]);
    expect(["qa_check_to_book", "site_visit_due", "qa_check_final_cancelled"].map(tierOfKind)).toEqual(["visit", "visit", "visit"]);
    expect(["material_request", "equipment_stranded", "hire_off_due", "job_moved"].map(tierOfKind)).toEqual(["move", "move", "move", "move"]);
  });
  it("a kind outside the ladder is listed and counted but never sets the icon", () => {
    const a = jobAttention([{ kind: "painter_message", title: "Marco wrote" }], [], false);
    expect(a).toMatchObject({ tier: "none", icon: "house", count: 1 });
    expect(a.lines).toEqual([{ tier: "other", label: "Marco wrote" }]);
    const b = jobAttention([{ kind: "no_work_requested", title: "No work asked" }], [], true);
    expect(b.tier).toBe("closed");
    expect(jobAttention([{ kind: "painter_message", title: "x" }], ["rubbish · not ordered"], false).lines.map((l) => l.tier)).toEqual(["move", "other"]);
  });
});
