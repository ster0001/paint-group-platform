import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VARIATION_STEPS, blockedReason, contractorDeltaCents, isOpen, stepIndex,
  type VariationStatus,
} from "./variations";

const SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261002000000_wo_variations_flow.sql"), "utf8");

describe("the contractor's share", () => {
  it("is hours × the rate, to the cent", () => {
    expect(contractorDeltaCents(3, 6000)).toBe(18000);      // 3 hrs at $60 = $180
    expect(contractorDeltaCents(1.5, 6000)).toBe(9000);
  });

  it("follows the settings rate rather than a hard-coded $60", () => {
    expect(contractorDeltaCents(3, 6500)).toBe(19500);      // rate raised to $65
  });

  it("rounds half-hours and odd rates to whole cents", () => {
    expect(contractorDeltaCents(2.25, 6733)).toBe(15149);   // 15149.25 -> 15149
    expect(Number.isInteger(contractorDeltaCents(2.25, 6733))).toBe(true);
  });

  it("refuses to invent money from nonsense", () => {
    expect(contractorDeltaCents(0, 6000)).toBe(0);
    expect(contractorDeltaCents(-3, 6000)).toBe(0);
    expect(contractorDeltaCents(Number.NaN, 6000)).toBe(0);
  });
});

describe("the five-step tracker", () => {
  it("has the mockup's five steps", () => {
    expect(VARIATION_STEPS).toEqual(["Raised", "Priced", "Customer", "Contractor", "Work"]);
  });

  it("lights up in order", () => {
    expect(stepIndex("raised")).toBe(0);
    expect(stepIndex("priced")).toBe(1);
    expect(stepIndex("customer_approved")).toBe(2);
    expect(stepIndex("contractor_accepted")).toBe(4);
  });

  it("does not show a declined variation as finished", () => {
    expect(stepIndex("declined")).toBeLessThan(4);
  });

  it("counts only the ones still waiting on somebody", () => {
    for (const s of ["raised", "priced", "customer_approved"] as VariationStatus[]) {
      expect(isOpen(s)).toBe(true);
    }
    for (const s of ["contractor_accepted", "declined", "cancelled"] as VariationStatus[]) {
      expect(isOpen(s)).toBe(false);
    }
  });

  it("words the blocker the way the console shows it", () => {
    expect(blockedReason([{ status: "priced" }])).toBe("1 variation still waiting on a decision");
    expect(blockedReason([{ status: "priced" }, { status: "raised" }]))
      .toBe("2 variations still waiting on a decision");
    expect(blockedReason([{ status: "contractor_accepted" }])).toBeNull();
    expect(blockedReason([])).toBeNull();
  });

  // Tom, 19 Oct 2026: with every area ticked off, an undecided variation no
  // longer holds the walkthrough — the office decides it in its own time.
  it("stops holding the job once every surface in scope is done", () => {
    expect(blockedReason([{ status: "raised" }], 0)).toBeNull();
    expect(blockedReason([{ status: "priced" }, { status: "customer_approved" }], 0)).toBeNull();
    expect(blockedReason([{ status: "raised" }], 2)).toBe("1 variation still waiting on a decision");
  });
});

const GATE_SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270277000000_walkthrough_with_open_variations.sql"), "utf8");

describe("the gate in the database (20270277)", () => {
  it("counts the undone surfaces in scope before an open variation can refuse", () => {
    expect(GATE_SQL).toContain("and not removed_from_scope and state <> 'done'");
    expect(GATE_SQL).toMatch(/if v_waiting > 0 then\s+select count\(\*\) into v_open/);
    expect(GATE_SQL).toContain("still waiting on a decision");
    expect(GATE_SQL).toMatch(/status in \('raised', 'priced', 'customer_approved'\)/);
  });
  it("keeps every other arm and registers itself", () => {
    expect(GATE_SQL).toContain("the pre-start list has not been built for this job yet");
    expect(GATE_SQL).toContain("surfaces still to tick off");
    expect(GATE_SQL).toContain("wo_qa_open_count(p_wo_id)");
    expect(GATE_SQL).toContain("wo_colour_match_outstanding(p_wo_id)");
    expect(GATE_SQL).toContain("insert into public._prod_migrations(name) values ('20270277000000_walkthrough_with_open_variations.sql')");
  });
});

// The rules that must live in the database, asserted against the SQL itself.
describe("what the database refuses to allow", () => {
  it("computes the contractor's money in SQL, never taking it from a caller", () => {
    expect(SQL).toContain("v_rate  := public.wo_contractor_rate_cents()");
    expect(SQL).toContain("v_delta := round(p_hours * v_rate)::integer");
    // The accept function must not accept an amount argument at all.
    expect(SQL).not.toMatch(/wo_contractor_accept_variation\([^)]*cents/);
  });

  it("reads the rate from settings, so editing it in the back end takes effect", () => {
    expect(SQL).toMatch(/from public\.settings where key = 'Contractor rate'/);
  });

  it("will not let a variation be accepted before the customer has approved it", () => {
    expect(SQL).toContain("return 'error:customer_not_approved'");
    expect(SQL).toMatch(/v_v\.status <> 'customer_approved' or v_v\.customer_responded_at is null/);
  });

  it("will not let a contractor accept an unreleased offer", () => {
    expect(SQL).toContain("return 'error:not_released'");
  });

  it("requires photos on every variation raised", () => {
    expect(SQL).toContain("return 'error:photos_required'");
  });

  it("keeps declined variations instead of deleting them", () => {
    expect(SQL).toContain("status = 'declined'");
    expect(SQL).not.toMatch(/delete from public\.wo_variations/);
  });

  it("keeps a human between the two money events by default", () => {
    expect(SQL).toContain("return 'error:not_approved'");
    expect(SQL).toMatch(/variationRelease.*'"auto"'::jsonb/);
  });

  it("blocks a forward stage move while a variation is open", () => {
    expect(SQL).toContain("still waiting on a decision");
    expect(SQL).toMatch(/status in \('raised', 'priced', 'customer_approved'\)/);
  });
});
