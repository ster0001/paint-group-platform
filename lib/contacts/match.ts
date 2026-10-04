/**
 * The Contact modal's search bar (Tom, 4 Oct 2026: "a search bar at the top of
 * the page when adding a new contact for an estimate"). One rule, in-memory —
 * the builder already loads the whole Contacts list for the estimate, and the
 * Contacts page's `?q=` filter matches the same fields.
 *
 * Matches a case-insensitive substring of the name, company, email or suburb;
 * a phone matches by digits with the spaces taken out of both sides, so
 * "0412 345" and "0412345" both find 0412 345 678. Fewer than three digits is
 * never a phone search (it would match everyone).
 */
export type SearchableContact = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  landline?: string | null;
  city?: string | null;
};

export function matchContacts<T extends SearchableContact>(contacts: T[], q: string, limit = 8): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const digits = needle.replace(/[\s().-]/g, "");
  const phoneSearch = digits.length >= 3 && /^\+?[0-9]+$/.test(digits);
  return contacts
    .filter((x) => {
      const hay = [x.first_name, x.last_name, x.company, x.email, x.city].filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(needle)) return true;
      if (!phoneSearch) return false;
      return [x.phone, x.landline].some((p) => p && p.replace(/[\s().-]/g, "").includes(digits));
    })
    .slice(0, limit);
}
