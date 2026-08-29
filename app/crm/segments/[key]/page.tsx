import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSegment } from "@/lib/crm/segmentsStore";
import SegmentBuilder from "../SegmentBuilder";

export const dynamic = "force-dynamic";

export default async function EditSegmentPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const supabase = await createClient();
  const segment = await getSegment(supabase, key);
  if (!segment) notFound();

  return (
    <>
      <Link className="back" href="/crm/segments">← Lists</Link>
      <SegmentBuilder initial={{
        key: segment.key,
        name: segment.name,
        description: segment.description,
        criteria: segment.criteria,
        standing: segment.standing === true,
      }} />
    </>
  );
}
