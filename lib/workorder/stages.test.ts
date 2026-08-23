import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TRANSITIONS,
  WO_STAGES,
  type WoStage,
  deriveStatus,
  findTransition,
  isLegalTransition,
  nextStages,
} from "./stages";

// The canonical seed moved when 'system' was allowed to start a job on its
// date; the mirror is diffed against wherever the list currently lives.
const MIGRATION = "supabase/migrations/20261103000000_wo_prep_questions.sql";
const MACHINE = "supabase/migrations/20260926000000_wo_loop_stage_machine.sql";

describe("the transition matrix", () => {
  it("allows exactly the ten moves the workflow defines", () => {
    expect(TRANSITIONS).toHaveLength(10);
  });

  // Every ordered pair of stages, checked. The legal ten pass; the other 39 —
  // including every self-move and every skip-a-stage jump — must not exist.
  const legal = new Set(TRANSITIONS.map((t) => `${t.from}>${t.to}`));

  it("refuses every pair that is not on the list", () => {
    const illegal: string[] = [];
    for (const from of WO_STAGES) {
      for (const to of WO_STAGES) {
        const key = `${from}>${to}`;
        if (legal.has(key)) continue;
        if (isLegalTransition(from, to)) illegal.push(key);
      }
    }
    expect(illegal).toEqual([]);
  });

  it("counts the illegal pairs so a silently-widened matrix is caught", () => {
    const total = WO_STAGES.length * WO_STAGES.length; // 49
    expect(total - legal.size).toBe(39);
  });

  it("cannot skip a stage on the happy path", () => {
    expect(isLegalTransition("offered", "in_progress")).toBe(false);
    expect(isLegalTransition("pre_start", "qa")).toBe(false);
    expect(isLegalTransition("offered", "closed")).toBe(false);
    expect(isLegalTransition("in_progress", "walkthrough")).toBe(false);
  });

  it("cannot reopen a closed job", () => {
    for (const to of WO_STAGES) {
      expect(isLegalTransition("closed", to)).toBe(false);
    }
  });

  it("routes both failure paths back into the same tick list", () => {
    expect(isLegalTransition("qa", "in_progress")).toBe(true);
    expect(isLegalTransition("walkthrough", "in_progress")).toBe(true);
  });

  it("lets a job walk the full happy path", () => {
    // Ruling of 23 Aug: prep comes BEFORE quality check — ticks done → prep,
    // prep confirmed → qa (when due) → walkthrough.
    const path: WoStage[] = [
      "offered", "pre_start", "in_progress", "completion_prep", "qa", "walkthrough", "closed",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(isLegalTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("lets a job with no QA due skip straight to prep", () => {
    expect(isLegalTransition("in_progress", "completion_prep")).toBe(true);
  });
});

describe("who may ask for a move", () => {
  it("never lets a contractor start their own job or sign it off", () => {
    expect(nextStages("pre_start", "contractor")).toEqual([]);
    expect(nextStages("walkthrough", "contractor")).toEqual([]);
  });

  it("never lets a customer touch the working stages", () => {
    expect(nextStages("in_progress", "customer")).toEqual([]);
    expect(nextStages("qa", "customer")).toEqual([]);
    expect(nextStages("pre_start", "customer")).toEqual([]);
  });

  it("lets the customer approve or flag at walkthrough, and nothing else", () => {
    expect(nextStages("walkthrough", "customer").map((t) => t.to).sort())
      .toEqual(["closed", "in_progress"]);
  });

  it("lets the sweep start a job on its own date, but nothing else new", () => {
    expect(nextStages("pre_start", "system").map((t) => t.to).sort())
      .toEqual(["in_progress", "offered"]);
  });

  it("keeps the QA verdict a staff decision — the machine routes a passed job from either session", () => {
    // The contractor cannot fail a check (that's the office's verdict). Once
    // every check has passed the MACHINE moves the job on (wo_record_qa /
    // wo_qa_route_passed) — from a staff OR a contractor session, which is why
    // the contractor actor is on this row; the painter never gets a button
    // (Tom, 23 Aug). The pack gate still refuses while any check is unpassed.
    expect(nextStages("qa", "contractor").map((t) => t.to)).toEqual(["walkthrough"]);
    // Pass sends the pack out (walkthrough); fail goes back to the brushes.
    expect(nextStages("qa", "staff").map((t) => t.to).sort())
      .toEqual(["in_progress", "walkthrough"]);
  });

  it("lets the contractor report the work finished", () => {
    // One exit only: prep. The qa-or-signoff split happens AFTER prep is
    // confirmed, and the server decides it — never the painter.
    expect(nextStages("in_progress", "contractor").map((t) => t.to).sort())
      .toEqual(["completion_prep"]);
    expect(nextStages("completion_prep", "contractor").map((t) => t.to).sort())
      .toEqual(["qa", "walkthrough"]);
  });
});

describe("status is derived, never typed", () => {
  it("keeps a WO that has not been issued as a draft", () => {
    expect(deriveStatus("offered", null)).toBe("draft");
  });

  it("shows an issued but unstarted job as issued", () => {
    expect(deriveStatus("offered", "2026-08-21T00:00:00Z")).toBe("issued");
    expect(deriveStatus("pre_start", "2026-08-21T00:00:00Z")).toBe("issued");
  });

  // A booking can be accepted before the estimate has a saved WO document. That
  // job is at pre_start but has never been issued, and saying "issued" on the
  // contractor's screen would be a lie. Found live, fixed in 20260929.
  it("does not call an unissued job issued just because it reached pre-start", () => {
    expect(deriveStatus("pre_start", null)).toBe("draft");
  });

  it("collapses the four working stages onto in_progress", () => {
    for (const s of ["in_progress", "qa", "completion_prep", "walkthrough"] as const) {
      expect(deriveStatus(s, "2026-08-21T00:00:00Z")).toBe("in_progress");
    }
  });

  it("closes to complete", () => {
    expect(deriveStatus("closed", "2026-08-21T00:00:00Z")).toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// The drift guard. The database decides; this module only mirrors it. Parse the
// migration's seed rows and diff them against TRANSITIONS, so editing one and
// forgetting the other fails here rather than in production.
// ---------------------------------------------------------------------------
describe("the mirror matches the migration", () => {
  const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");
  const machine = readFileSync(resolve(process.cwd(), MACHINE), "utf8");

  const rows = [...sql.matchAll(
    /\(\s*'(\w+)',\s*'(\w+)',\s*'([^']*)',\s*array\[([^\]]+)\]\s*\)/g,
  )].map((m) => ({
    from: m[1],
    to: m[2],
    label: m[3],
    actors: m[4].split(",").map((a) => a.trim().replace(/'/g, "")).sort(),
  }));

  it("found the seed rows to compare against", () => {
    expect(rows.length).toBe(TRANSITIONS.length);
  });

  it("agrees on every from, to, label and actor list", () => {
    const fromSql = rows
      .map((r) => `${r.from}>${r.to}|${r.label}|${r.actors.join(",")}`)
      .sort();
    const fromTs = TRANSITIONS
      .map((t) => `${t.from}>${t.to}|${t.label}|${[...t.actors].sort().join(",")}`)
      .sort();
    expect(fromTs).toEqual(fromSql);
  });

  it("derives status the same way the SQL does", () => {
    // The SQL arms, read back as a crude contract check: closed -> complete,
    // pre_start -> issued, offered -> draft/issued on issued_at, else in_progress.
    const fix = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260929000000_wo_derive_status_fix.sql"), "utf8");
    expect(fix).toContain("when p_stage = 'closed' then 'complete'");
    expect(fix).toContain("when p_stage in ('offered', 'pre_start') then");
    expect(fix).toMatch(/p_issued_at is null then 'draft'/);
    // and the invariant is restored for rows that predate the fix
    expect(fix).toContain("update public.work_orders");
    expect(fix).toContain("status is distinct from public.wo_derive_status(stage, issued_at)");
  });

  it("locks the state columns away from client writes", () => {
    expect(machine).toContain(
      "revoke update (stage, stage_entered_at, blocked_reason) on public.work_orders from authenticated",
    );
  });

  it("writes an event on every transition", () => {
    expect(machine).toMatch(/insert into public\.wo_events[\s\S]*?'stage_changed'/);
  });
});

describe("transition metadata", () => {
  it("labels every move in plain English", () => {
    for (const t of TRANSITIONS) {
      expect(t.label.length).toBeGreaterThan(8);
      expect(findTransition(t.from, t.to)?.label).toBe(t.label);
    }
  });

  it("gives every move at least one actor", () => {
    for (const t of TRANSITIONS) expect(t.actors.length).toBeGreaterThan(0);
  });
});
