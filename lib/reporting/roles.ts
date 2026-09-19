/**
 * Home dashboard v2 · 0d — who sees which section (Tom's rulings, 19 Sep 2026).
 *
 * ⚑1 Five roles; a person may hold several and sees the UNION of sections.
 * ⚑2 Margins, P&L, targets and marketing spend are owner/admin only; PC and
 *    sales see job values, never margin. The database says the same thing
 *    (`dashboard_roles()`, `dashboard_sees_money()` in 20270179) — this module
 *    is the app-side twin for rendering and for the export route's gate.
 *
 * The master user (profiles.is_owner) holds every role whatever the column
 * says; a staff login with no roles sees only the role-free sections.
 */

export const DASHBOARD_ROLES = ["owner", "admin", "pc", "sales", "finance"] as const;
export type DashboardRole = (typeof DASHBOARD_ROLES)[number];

export const ROLE_LABEL: Record<DashboardRole, string> = {
  owner: "Owner", admin: "Admin", pc: "Project coordinator", sales: "Sales", finance: "Finance",
};

/** The page's sections (brief v2 Part C). `activity` is for every staff login, role-scoped inside. */
export const DASHBOARD_SECTIONS = [
  "needs_doing", "sales", "funnel", "pc_command", "contractors", "invoicing", "pl", "marketing", "activity",
] as const;
export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

/** Part C, one line per section: who the brief lists. Owner and admin see everything. */
const SECTION_ROLES: Record<DashboardSection, ReadonlyArray<DashboardRole>> = {
  needs_doing: ["owner", "admin", "pc", "sales", "finance"],
  sales:       ["owner", "admin", "sales"],
  funnel:      ["owner", "admin", "sales"],
  pc_command:  ["owner", "admin", "pc"],
  contractors: ["owner", "admin", "pc"],
  invoicing:   ["owner", "admin", "finance"],
  pl:          ["owner", "admin"],
  marketing:   ["owner", "admin"],
  activity:    ["owner", "admin", "pc", "sales", "finance"],
};

/** ⚑2: the sections and figures that carry margin, P&L, targets or marketing spend. */
export const MONEY_SECTIONS: ReadonlySet<DashboardSection> = new Set(["pl", "marketing"]);

export function isDashboardRole(value: unknown): value is DashboardRole {
  return typeof value === "string" && (DASHBOARD_ROLES as readonly string[]).includes(value);
}

/** The roles a login actually holds: the master user holds all five. */
export function effectiveRoles(input: { isOwner: boolean; roles: ReadonlyArray<string> }): DashboardRole[] {
  if (input.isOwner) return [...DASHBOARD_ROLES];
  const out = new Set<DashboardRole>();
  for (const r of input.roles) if (isDashboardRole(r)) out.add(r);
  return DASHBOARD_ROLES.filter((r) => out.has(r));
}

export function seesMoney(roles: ReadonlyArray<DashboardRole>): boolean {
  return roles.includes("owner") || roles.includes("admin");
}

export function canSeeSection(roles: ReadonlyArray<DashboardRole>, section: DashboardSection): boolean {
  return SECTION_ROLES[section].some((r) => roles.includes(r));
}

/** The union of every held role's sections, in page order. */
export function sectionsFor(roles: ReadonlyArray<DashboardRole>): DashboardSection[] {
  return DASHBOARD_SECTIONS.filter((s) => canSeeSection(roles, s));
}
