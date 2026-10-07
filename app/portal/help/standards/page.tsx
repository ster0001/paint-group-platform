import { getContractorSession } from "@/lib/contractor/session";
import { loadStandards } from "@/lib/standards/load";
import { StandardsIndex, StandardsUnavailable } from "@/app/components/standards/StandardsViews";

export const dynamic = "force-dynamic";

/**
 * The painter's finish standards, under Help (brief §7; Step 0 report §9 —
 * the portal already has a Help tab, so the standards live in it rather than
 * as a seventh bottom tab). Help's own gate: a suspended painter keeps it.
 */
export default async function PortalStandardsPage({ searchParams }: { searchParams: Promise<{ side?: string }> }) {
  await getContractorSession();
  const { side } = await searchParams;
  const { standards, error } = await loadStandards();
  return (
    <div className="wrap">
      {standards
        ? <StandardsIndex standards={standards} base="portal" side={side === "exterior" ? "exterior" : "interior"}
            intro={<p className="hint" style={{ marginTop: 0 }}>What we expect on every surface, at the level on your work order. Open a surface, then read the column for your job&rsquo;s level.</p>} />
        : <StandardsUnavailable message={error} />}
    </div>
  );
}
