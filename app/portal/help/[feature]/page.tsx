import Link from "next/link";
import { notFound } from "next/navigation";
import { getContractorSession } from "@/lib/contractor/session";
import { readGuide, rolesFor } from "@/lib/help/content";
import HelpArticle from "@/app/components/help/HelpArticle";

export const dynamic = "force-dynamic";

export default async function PortalHelpGuidePage({ params }: { params: Promise<{ feature: string }> }) {
  await getContractorSession();
  const { feature } = await params;
  // A contractor session can only ever open contractor files. Anything else
  // is not found — not forbidden — so the existence of an office guide never
  // shows through.
  const guide = readGuide(feature, "contractor", rolesFor("contractor"), "portal");
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
