import Link from "next/link";
import { getContractorSession } from "@/lib/contractor/session";
import { guidesFor, loadTour, rolesFor, searchGuides } from "@/lib/help/content";
import PortalTour from "../PortalTour";

export const dynamic = "force-dynamic";

/**
 * The painter's help centre: every contractor guide the index knows, and only
 * those. Uses the non-suspending session gate on purpose — a suspended
 * contractor keeps help (Phase C ⚑ C-3), the notice page explains the rest.
 */
export default async function PortalHelpPage({ searchParams }: { searchParams: Promise<{ q?: string; tour?: string }> }) {
  await getContractorSession();
  const roles = rolesFor("contractor");
  const guides = guidesFor(roles);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const hits = q ? searchGuides(q, roles) : null;
  const tour = loadTour("contractor");
  const replay = sp.tour === "1" && tour.length > 0;

  return (
    <div className="wrap">
      <h1>Help</h1>
      <p className="slab">Step-by-step guides for every screen — with pictures and a short film</p>

      <form method="get" action="/portal/help" className="card" style={{ display: "flex", gap: 8, alignItems: "center" }} role="search">
        <input type="search" name="q" defaultValue={q} placeholder="Search the guides — e.g. before photo" aria-label="Search the guides" data-testid="help-search" style={{ flex: 1, margin: 0 }} />
        <button type="submit" className="btn cy narrow" style={{ marginTop: 0 }}>Search</button>
      </form>

      {hits && (
        <div className="card" data-testid="help-results">
          <h3>{hits.length === 0 ? `Nothing mentions “${q}”` : `${hits.length} guide${hits.length === 1 ? "" : "s"} mention “${q}”`}</h3>
          {hits.length === 0 && <p className="hint">Try a word from the screen you are on, or ring the office.</p>}
          {hits.map((h) => (
            <Link key={h.entry.feature} href={`/portal/help/${h.entry.feature}`} className="act" data-testid={`hit-${h.entry.feature}`}>
              <i aria-hidden>▸</i>
              <span>
                {h.entry.title}
                <br />
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>{h.snippet}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {guides.length === 0 ? (
        <div className="empty">
          <i aria-hidden>?</i>
          <b>No guides yet</b>
          The office is writing them. In the meantime, call the office number on your work order.
        </div>
      ) : (
        <div className="card" data-testid="help-list">
          {guides.map((g) => (
            <Link key={g.feature} href={`/portal/help/${g.feature}`} className="act" data-testid={`help-${g.feature}`}>
              <i aria-hidden>▸</i>
              <span>
                {g.title}
                <br />
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>{g.summary}</span>
              </span>
              {g.walkthrough && (
                <span className="push">
                  <span className="chip cyn">Film</span>
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {tour.length > 0 && (
        <Link href="/portal/help?tour=1" className="btn gh" data-testid="tour-replay">Show me around again</Link>
      )}
      <p className="hint">Stuck on something these don&rsquo;t cover? Ring the office — the number is on your work order.</p>
      {replay && <PortalTour cards={tour} replay />}
    </div>
  );
}
