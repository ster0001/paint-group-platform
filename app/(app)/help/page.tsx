import Link from "next/link";
import { guidesFor, rolesFor, searchGuides } from "@/lib/help/content";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { staff: "Office", pc: "Project coordinator" };

/**
 * The office help centre. The (app) layout has already established a staff
 * session; office staff read the staff and pc guides (pc is a specialisation
 * of staff), never the contractor ones — those belong in the portal.
 */
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const roles = rolesFor("staff");
  const guides = guidesFor(roles);
  const features = [...new Set(guides.map((g) => g.feature))];
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const hits = q ? searchGuides(q, roles) : null;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight">Help</h1>
      <p className="mt-1 text-sm text-gray-500">Step-by-step guides for every screen, written from the real thing, with a short film each.</p>
      <form method="get" action="/help" role="search" className="mt-4 flex max-w-xl gap-2">
        <input type="search" name="q" defaultValue={q} placeholder="Search the guides — e.g. mark paid" aria-label="Search the guides" data-testid="help-search"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white">Search</button>
      </form>
      {hits && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4" data-testid="help-results">
          <div className="text-sm font-medium">{hits.length === 0 ? `Nothing mentions “${q}”` : `${hits.length} guide${hits.length === 1 ? "" : "s"} mention “${q}”`}</div>
          <ul className="mt-2 divide-y divide-gray-100">
            {hits.map((h) => (
              <li key={`${h.entry.feature}/${h.entry.role}`} className="py-2">
                <Link href={`/help/${h.entry.feature}/${h.entry.role}`} className="font-medium hover:underline" data-testid={`hit-${h.entry.feature}-${h.entry.role}`}>
                  {h.entry.title}
                </Link>
                <div className="text-xs uppercase tracking-wide text-gray-400">{h.entry.feature.replace(/-/g, " ")} · {ROLE_LABEL[h.entry.role] ?? h.entry.role}</div>
                <div className="mt-0.5 text-sm text-gray-600">{h.snippet}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2" data-testid="help-list">
        {guides.map((g) => (
          <Link
            key={`${g.feature}/${g.role}`}
            href={`/help/${g.feature}/${g.role}`}
            className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300"
            data-testid={`help-${g.feature}-${g.role}`}
          >
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {g.feature.replace(/-/g, " ")} · {ROLE_LABEL[g.role] ?? g.role}
            </div>
            <div className="mt-1 font-medium">{g.title}</div>
            <div className="mt-1 text-sm text-gray-600">{g.summary}</div>
          </Link>
        ))}
        {guides.length === 0 && <div className="text-sm text-gray-500">No guides yet.</div>}
      </div>
      {features.length > 0 && (
        <p className="mt-6 text-xs text-gray-400">
          Contractors have their own guides inside the contractor portal; they are not shown here.
        </p>
      )}
    </div>
  );
}
