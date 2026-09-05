/**
 * Staff logins and what each one sees (Tom, 5 Sep 2026).
 *
 * One master user (profiles.is_owner) creates the other office logins in
 * Settings → Company → Staff logins and ticks, per person, which areas of
 * the staff app they see. The map is profiles.staff_access: { areaKey:
 * false } hides an area; a missing key means visible, so a new area added
 * later is shown to everyone until someone hides it. Owners see everything
 * and the map is ignored for them.
 *
 * Hiding is enforced twice: the sidebar drops the entry, and every area's
 * layout redirects a hidden visitor to their first visible area. RLS is
 * unchanged — every staff login still holds the same database rights; this
 * is a screen-level control, which is what was asked for.
 */

export const STAFF_AREAS = [
  { key: "estimates",   label: "Estimates",   href: "/estimates",   prefixes: ["/estimates", "/quote"] },
  { key: "proving",     label: "Proving",     href: "/proving",     prefixes: ["/proving"] },
  { key: "projects",    label: "Projects",    href: "/pc",          prefixes: ["/pc"] },
  { key: "invoicing",   label: "Invoicing",   href: "/invoices",    prefixes: ["/invoices"] },
  { key: "payments",    label: "Payments",    href: "/invoicing",   prefixes: ["/invoicing"] },
  { key: "contacts",    label: "Contacts",    href: "/contacts",    prefixes: ["/contacts"] },
  { key: "crm",         label: "CRM",         href: "/crm",         prefixes: ["/crm"] },
  { key: "contractors", label: "Contractors", href: "/contractors", prefixes: ["/contractors"] },
  { key: "settings",    label: "Settings",    href: "/settings",    prefixes: ["/settings"] },
] as const;

export type StaffAreaKey = (typeof STAFF_AREAS)[number]["key"];
export const STAFF_AREA_KEYS = STAFF_AREAS.map((a) => a.key) as StaffAreaKey[];

/** { areaKey: false } hides; anything else (missing, true) shows. */
export type StaffAccess = Partial<Record<StaffAreaKey, boolean>>;

export type StaffVisibility = { isOwner: boolean; access: StaffAccess };

/** The column is jsonb; anything that is not a plain object of booleans is ignored. */
export function parseStaffAccess(value: unknown): StaffAccess {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: StaffAccess = {};
  for (const key of STAFF_AREA_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

export function canSee(vis: StaffVisibility, key: StaffAreaKey): boolean {
  if (vis.isOwner) return true;
  return vis.access[key] !== false;
}

/** The area a path belongs to (longest prefix wins), or null for paths outside the staff app. */
export function areaForPath(pathname: string): StaffAreaKey | null {
  const path = pathname.split("?")[0];
  let best: { key: StaffAreaKey; len: number } | null = null;
  for (const a of STAFF_AREAS) {
    for (const p of a.prefixes) {
      if ((path === p || path.startsWith(p + "/")) && (!best || p.length > best.len)) best = { key: a.key, len: p.length };
    }
  }
  return best?.key ?? null;
}

/** Where to send someone who landed on an area they cannot see: their first visible one. */
export function firstVisibleHref(vis: StaffVisibility): string {
  for (const a of STAFF_AREAS) if (canSee(vis, a.key)) return a.href;
  return "/account";
}

/** The visible entries for the sidebar, in the standing order. */
export function visibleAreas(vis: StaffVisibility): StaffAreaKey[] {
  return STAFF_AREAS.filter((a) => canSee(vis, a.key)).map((a) => a.key);
}
