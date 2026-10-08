import Link from "next/link";
import { getContractorSession } from "@/lib/contractor/session";
import { createClient } from "@/lib/supabase/server";
import { loadStandards } from "@/lib/standards/load";
import { loadMyStandards } from "@/lib/standards/status";
import { needsSignoff, painterStatusLine } from "@/lib/standards/acks";
import { StandardsIndex, StandardsUnavailable } from "@/app/components/standards/StandardsViews";

export const dynamic = "force-dynamic";

/**
 * The painter's finish standards, under Help (brief §7; Step 0 report §9 —
 * the portal already has a Help tab, so the standards live in it rather than
 * as a seventh bottom tab). Help's own gate: a suspended painter keeps it.
 */
export default async function PortalStandardsPage({ searchParams }: { searchParams: Promise<{ side?: string }> }) {
  const { contractor } = await getContractorSession();
  const { side } = await searchParams;
  const supabase = await createClient();
  const [{ standards, error }, mine] = await Promise.all([loadStandards(), contractor ? loadMyStandards(supabase, contractor.id) : Promise.resolve({ my: null, error: null })]);
  const my = mine.my;
  return (
    <div className="wrap">
      {standards
        ? <StandardsIndex standards={standards} base="portal" side={side === "exterior" ? "exterior" : "interior"}
            intro={<>
              <p className="hint" style={{ marginTop: 0 }}>What we expect on every surface, at the level on your work order. Open a surface, then read the column for your job&rsquo;s level.</p>
              {my?.status === "confirmed" && (
                <div className="std-row" data-testid="standards-confirmed"><span className="std-pill info">✓ {painterStatusLine("confirmed", my)}</span></div>
              )}
              {my && needsSignoff(my.status) && (
                <Link href="/portal/standards/confirm" className="std-card" style={{ textDecoration: "none", color: "inherit" }} data-testid="standards-signoff-prompt">
                  <span className="std-eyebrow">Please confirm</span>
                  <b>{painterStatusLine(my.status, my)}</b>
                  <span className="std-link">Read and confirm the six sections ›</span>
                </Link>
              )}
            </>} />
        : <StandardsUnavailable message={error} />}
    </div>
  );
}
