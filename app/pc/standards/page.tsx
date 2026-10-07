import { loadStandards } from "@/lib/standards/load";
import { StandardsIndex, StandardsUnavailable } from "@/app/components/standards/StandardsViews";

export const dynamic = "force-dynamic";

/** The same standards the painter reads, in PC Command (ruling S12). The PC layout gates staff. */
export default async function PcStandardsPage({ searchParams }: { searchParams: Promise<{ side?: string }> }) {
  const { side } = await searchParams;
  const { standards, error } = await loadStandards();
  return (
    <div className="card" style={{ marginTop: 14 }}>
      {standards
        ? <StandardsIndex standards={standards} base="pc" side={side === "exterior" ? "exterior" : "interior"}
            intro={<p className="note">The record a painter reads from a work-order surface line. A quality check judges against the same words.</p>} />
        : <StandardsUnavailable message={error} />}
    </div>
  );
}
