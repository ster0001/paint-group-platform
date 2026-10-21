import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Tom, 21 Oct 2026: the final walkthrough is booked and run whether or not the
 * quality check has passed. Three rules changed in 20270284 and nothing else;
 * this pins the file so a later rewrite of any of the three functions cannot
 * quietly put the hold back (the way 20270241 had to re-free the rebook).
 */
const FILE = "20270284000000_walkthrough_before_quality_check.sql";
const SQL = readFileSync(resolve(process.cwd(), "supabase/migrations", FILE), "utf8");

function body(fn: string): string {
  const at = SQL.indexOf(`create or replace function public.${fn}(`);
  expect(at, `${fn} is defined in ${FILE}`).toBeGreaterThan(-1);
  const end = SQL.indexOf("end $$;", at);
  return SQL.slice(at, end);
}

describe("20270284 — the walkthrough before the quality check", () => {
  test("wo_book_walkthrough has no qa_first arm", () => {
    const b = body("wo_book_walkthrough");
    expect(b).not.toContain("qa_first");
    expect(b).not.toContain("wo_qa_open_count");
    // The rest of the 20270241 body is intact: time column, cancel-then-insert, the event.
    expect(b).toContain("scheduled_time");
    expect(b).toContain("set status = 'cancelled'");
    expect(b).toContain("'walkthrough_booked'");
  });

  test("wo_gate_blocked: an open check holds closed only, never the walkthrough", () => {
    const b = body("wo_gate_blocked");
    expect(b).toContain("if p_to = 'closed' and p_from in ('completion_prep', 'qa') then");
    expect(b).not.toContain("if p_to in ('walkthrough', 'closed') and p_from in ('completion_prep', 'qa') then\n    v_open := public.wo_qa_open_count");
    // Every other arm of 20270277 is still there.
    expect(b).toContain("the pre-start list has not been built for this job yet");
    expect(b).toContain("surfaces still to tick off");
    expect(b).toContain("still waiting on a decision");
    expect(b).toContain("completion item");
    expect(b).toContain("wo_colour_match_outstanding");
    expect(b).toContain("if p_to = 'walkthrough' and p_from = 'closed' then");
  });

  test("wo_start_walkthrough_mode delivers the pack from qa and records it", () => {
    const b = body("wo_start_walkthrough_mode");
    expect(b).toContain("if v_w.stage = 'qa' then");
    expect(b).toContain("public.wo_deliver_evidence_pack(p_work_order_id)");
    expect(b).toContain("'walkthrough_before_qa'");
    expect(b).toContain("if v_w.stage is distinct from 'walkthrough' then return 'error:not_at_walkthrough'; end if;");
    expect(b).toContain("walkthrough_session_token = v_token");
  });

  test("grants are explicit and the file registers itself", () => {
    expect(SQL).toContain("grant execute on function public.wo_book_walkthrough(uuid, text, date, text, time) to authenticated;");
    expect(SQL).toContain("grant execute on function public.wo_start_walkthrough_mode(uuid) to authenticated;");
    expect(SQL).toMatch(/^set lock_timeout = '15s';$/m);
    expect(SQL).toContain(`insert into public._prod_migrations(name) values ('${FILE}') on conflict (name) do nothing;`);
  });
});
