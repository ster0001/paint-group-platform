import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSegment } from "@/lib/crm/segmentsStore";
import SegmentBuilder from "../SegmentBuilder";
import { loadBuilderOptions } from "../options";

export const dynamic = "force-dynamic";

export default async function EditSegmentPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const supabase = await createClient();
  const [segment, options] = await Promise.all([getSegment(supabase, key), loadBuilderOptions(supabase)]);
  if (!segment) notFound();

  return (
    <>
      <Link className="back" href="/crm/segments">← Lists</Link>
      <SegmentBuilder
        options={options}
        initial={{
          key: segment.key,
          name: segment.name,
          description: segment.description,
          audience: segment.audience,
          standing: segment.standing === true,
          dropped: segment.dropped,
          legacy: segment.legacy,
        }} />
    </>
  );
}
