import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { emptyAudience } from "@/lib/crm/segments";
import SegmentBuilder from "../SegmentBuilder";
import { loadBuilderOptions } from "../options";

export const dynamic = "force-dynamic";

export default async function NewSegmentPage() {
  const supabase = await createClient();
  const options = await loadBuilderOptions(supabase);
  return (
    <>
      <Link className="back" href="/crm/segments">← Lists</Link>
      <SegmentBuilder options={options} initial={{ key: null, name: "", description: "", audience: emptyAudience(), standing: false }} />
    </>
  );
}
