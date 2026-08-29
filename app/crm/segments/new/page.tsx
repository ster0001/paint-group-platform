import Link from "next/link";
import SegmentBuilder from "../SegmentBuilder";

export const dynamic = "force-dynamic";

export default function NewSegmentPage() {
  return (
    <>
      <Link className="back" href="/crm/segments">← Lists</Link>
      <SegmentBuilder initial={{ key: null, name: "", description: "", criteria: [], standing: false }} />
    </>
  );
}
