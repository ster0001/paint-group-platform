import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Further instructions for the crew from PC Command (Tom, 8 Oct 2026).
 * work_orders.crew_notes is the one place the note lives; the issued sheet
 * follows it by trigger. Pins the migration's shape — the behaviour itself is
 * proven against the database by e2e/pc-colour-list-crew-instructions.spec.ts.
 */
const FILE = "20270244000000_wo_crew_notes_follow.sql";
const sql = readFileSync(join(process.cwd(), "supabase/migrations", FILE), "utf8");
const statements = sql.replace(/--.*$/gm, "").trim();

describe("20270244 crew notes follow the column", () => {
  it("opens with a lock timeout and registers itself last", () => {
    expect(statements.startsWith("set lock_timeout = '15s';")).toBe(true);
    expect(statements.endsWith(`insert into public._prod_migrations(name) values ('${FILE}') on conflict (name) do nothing;`)).toBe(true);
  });

  it("converges on a re-run", () => {
    expect(sql).toMatch(/create or replace function public\.wo_crew_notes_to_snapshot\(\)/);
    expect(sql).toMatch(/drop trigger if exists t_wo_crew_notes_to_snapshot on public\.work_orders;/);
    expect(sql).toMatch(/create or replace function public\.wo_set_crew_notes\(/);
  });

  it("the sheet follows the column on any write of either", () => {
    expect(sql).toMatch(/before insert or update of crew_notes, wo_snapshot on public\.work_orders/);
  });

  it("the RPC is staff-only, refuses closed jobs and caps the length", () => {
    expect(sql).toMatch(/if not public\.is_staff\(\) then return 'error:not_staff'/);
    expect(sql).toMatch(/v_wo\.stage = 'closed' then return 'error:closed'/);
    expect(sql).toMatch(/length\(v_notes\) > 4000 then return 'error:too_long'/);
  });

  it("grants the RPC to signed-in sessions only, and the trigger function to nobody", () => {
    expect(sql).toMatch(/grant execute on function public\.wo_set_crew_notes\(uuid, text\) to authenticated;/);
    expect(sql).not.toMatch(/grant execute on function public\.wo_set_crew_notes\(uuid, text\) to anon/);
    expect(sql).toMatch(/revoke all on function public\.wo_crew_notes_to_snapshot\(\) from public, anon, authenticated;/);
  });

  it("ends with a read-back carrying _expect_ values", () => {
    expect(sql).toMatch(/_expect_fn_present/);
    expect(sql).toMatch(/_expect_trigger_present/);
    expect(sql).toMatch(/_expect_anon_may_execute/);
  });
});
