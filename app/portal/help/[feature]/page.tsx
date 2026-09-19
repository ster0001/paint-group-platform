import Link from "next/link";
import { notFound } from "next/navigation";
import { getContractorSession } from "@/lib/contractor/session";
import { readGuide, rolesFor } from "@/lib/help/content";
import HelpArticle from "@/app/components/help/HelpArticle";

export const dynamic = "force-dynamic";

export default async function PortalHelpGuidePage({ params }: { params: Promise<{ feature: string }> }) {
  const { employmentType } = await getContractorSession();
  const { feature } = await params;
  // WHICH MANUAL (Tom, 19 Sep: "none of the walkthrough gifs work on mobile in
  // the contractor portal"). This page used to ask for the CONTRACTOR file
  // whoever was reading, while `/api/help/media` resolved the reader's real
  // role — so an employee was served the contractor guide and then refused its
  // pictures: a broken "Walkthrough" icon on every guide with a film, which is
  // what Saulius's phone showed. The two must ask the same question, and the
  // answer to it is `rolesFor` — not a literal. The guide the employee gets is
  // now their own, which also closes the money leak: the contractor scheduling
  // guide opens "Each offer comes with the dates, the calculated labour hours,
  // YOUR PRICE and a 24-hour clock", and an employee never sees a figure.
  //
  // A portal session can only ever open portal files. Anything else is not
  // found — not forbidden — so the existence of an office guide never shows
  // through, and neither does a contractor guide to an employee.
  const guide = readGuide(feature, employmentType, rolesFor(employmentType), "portal");
  if (!guide) notFound();

  return (
    <div className="wrap" data-testid="help-guide">
      <Link href="/portal/help" className="backlink">← Help</Link>
      <h1 style={{ marginTop: 10 }}>{guide.entry.title}</h1>
      <p className="slab">{guide.entry.summary}</p>
      {guide.entry.walkthrough && (
        <div className="card" data-testid="help-film">
          <h3>Watch it first</h3>
          <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>A short silent film of the steps below, on the real screens.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- our own role-gated media route; a GIF, not an optimisable image */}
          <img
            src={`/api/help/media/${guide.entry.feature}/${guide.entry.walkthrough.replace(/^media\//, "")}`}
            alt="Walkthrough"
            style={{ display: "block", width: "100%", maxWidth: 390, borderRadius: 12, border: "1px solid var(--line)" }}
          />
        </div>
      )}
      <div className="card">
        <HelpArticle blocks={guide.blocks} mode="portal" />
      </div>
    </div>
  );
}
