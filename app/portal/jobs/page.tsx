import { requireContractor } from "@/lib/contractor/session";
import Placeholder from "../Placeholder";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  await requireContractor();
  return (
    <Placeholder
      title="Jobs"
      slab="Current · upcoming · previous"
      icon="▤"
      heading="No jobs yet"
      body="Every job you accept lands here with its work order — the full scope, finish level, colours and materials — so you can tick surfaces off, add photos and flag variations as you go."
      soon="Arrives with work orders"
    />
  );
}
