import { notFound } from "next/navigation";
import { loadStandards } from "@/lib/standards/load";
import { SECTION_KEYS, type SectionKey } from "@/lib/standards/model";
import { StandardsSection, StandardsUnavailable } from "@/app/components/standards/StandardsViews";

export const dynamic = "force-dynamic";

export default async function PcStandardsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(SECTION_KEYS as readonly string[]).includes(section)) notFound();
  const { standards, error } = await loadStandards();
  if (!standards) return <div className="card" style={{ marginTop: 14 }}><StandardsUnavailable message={error} /></div>;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <StandardsSection standards={standards} section={section as SectionKey} back={{ href: "/pc/standards", label: "Standards" }} />
    </div>
  );
}
