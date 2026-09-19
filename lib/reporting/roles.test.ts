/**
 * Dashboard 0d — Tom's two rulings, pinned: five roles with a union of
 * sections (⚑1), and dollars for owner/admin only (⚑2). The migration's
 * enum and its money rule are read from the file so the paste cannot drift.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_ROLES, DASHBOARD_SECTIONS, MONEY_SECTIONS, canSeeSection, effectiveRoles, isDashboardRole, sectionsFor, seesMoney,
} from "./roles";

const FILE = "20270179000000_dashboard_settings_roles.sql";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations", FILE), "utf8");

describe("dashboard 0d · roles (⚑1)", () => {
  it("the enum in Postgres is the list in the app, in order", () => {
    const m = sql.match(/create type public\.staff_role as enum \(([^)]*)\)/);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])).toEqual([...DASHBOARD_ROLES]);
  });
  it("the master user holds every role; anyone else holds what was ticked, unknown strings dropped", () => {
    expect(effectiveRoles({ isOwner: true, roles: [] })).toEqual([...DASHBOARD_ROLES]);
    expect(effectiveRoles({ isOwner: false, roles: ["sales", "bogus", "pc"] })).toEqual(["pc", "sales"]);
    expect(effectiveRoles({ isOwner: false, roles: [] })).toEqual([]);
    expect(isDashboardRole("finance")).toBe(true);
    expect(isDashboardRole("Finance")).toBe(false);
  });
  it("two roles see the union of their sections", () => {
    expect(sectionsFor(["pc"])).toEqual(["needs_doing", "pc_command", "contractors", "activity"]);
    expect(sectionsFor(["sales"])).toEqual(["needs_doing", "sales", "funnel", "activity"]);
    expect(sectionsFor(["pc", "sales"])).toEqual(["needs_doing", "sales", "funnel", "pc_command", "contractors", "activity"]);
    expect(sectionsFor(["finance"])).toEqual(["needs_doing", "invoicing", "activity"]);
    expect(sectionsFor([])).toEqual([]);
  });
});

describe("dashboard 0d · who sees dollars (⚑2)", () => {
  it("owner and admin see everything, P&L and marketing included", () => {
    expect(sectionsFor(["owner"])).toEqual([...DASHBOARD_SECTIONS]);
    expect(sectionsFor(["admin"])).toEqual([...DASHBOARD_SECTIONS]);
    expect(seesMoney(["admin"])).toBe(true);
  });
  it("pc, sales and finance never reach a money section, alone or together", () => {
    for (const s of MONEY_SECTIONS) {
      expect(canSeeSection(["pc", "sales", "finance"], s)).toBe(false);
    }
    expect(seesMoney(["pc", "sales", "finance"])).toBe(false);
  });
  it("Postgres says the same: dashboard_sees_money() is owner or admin, and the two tables gate on it", () => {
    expect(sql).toMatch(/dashboard_sees_money\(\)[\s\S]*?select public\.has_dashboard_role\('owner', 'admin'\)/);
    expect(sql).toContain("create policy sales_targets_money_roles on public.sales_targets\n  for all to authenticated using (public.dashboard_sees_money()) with check (public.dashboard_sees_money());");
    expect(sql).toContain("create policy marketing_spend_money_roles on public.marketing_spend\n  for all to authenticated using (public.dashboard_sees_money()) with check (public.dashboard_sees_money());");
  });
  it("only the master user changes roles, and the file registers itself", () => {
    expect(sql).toContain("or new.staff_roles is distinct from old.staff_roles)");
    expect(sql).toContain(`insert into public._prod_migrations(name) values ('${FILE}') on conflict (name) do nothing;`);
  });
});
