import { notFound } from "next/navigation";
import { getContractorSession } from "@/lib/contractor/session";
import { loadStandards } from "@/lib/standards/load";
import { SECTION_KEYS, type SectionKey } from "@/lib/standards/model";
import { StandardsSection, StandardsUnavailable } from "@/app/components/standards/StandardsViews";

export const dynamic = "force-dynamic";

/** One of the rule pages: the three levels, rules for every job, your time, the defect rule, the final checklist, words. */
export default async function PortalStandardsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  await getContractorSession();
  const { section } = await params;
  if (!(SECTION_KEYS as readonly string[]).includes(section)) notFound();
  const { standards, error } = await loadStandards();
  if (!standards) return <div className="wrap"><StandardsUnavailable message={error} /></div>;
  return (
    <div className="wrap">
      <StandardsSection standards={standards} section={section as SectionKey} back={{ href: "/portal/help/standards", label: "Standards" }} />
    </div>
  );
}
