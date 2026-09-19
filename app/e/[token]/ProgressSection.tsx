import JobTimeline from "@/app/account/(portal)/JobTimeline";
import type { CustomerSnapshot } from "@/lib/customer/snapshot";
import { buildProgressPreview, type DemoPainter, type MessagingSet } from "@/lib/progress-preview/build";
import { SAMPLE_PROJECT, sampleTimeline } from "@/lib/progress-preview/timelineItems";
import ProgressPhone from "./ProgressPhone";

/**
 * Live-progress phone on the customer estimate (brief v4, Tom 19 Sep).
 * Server Component: builds the preview from the SENT snapshot (customer
 * payload only), hands the shared portal JobTimeline sample data, and gives
 * the client phone the rendered feed. page.tsx decides whether this renders
 * at all (presentation attached); this file never reads the database.
 */
export default function ProgressSection({ snapshot, set, demoPainter, organisationName, references }: {
  snapshot: CustomerSnapshot;
  set: MessagingSet;
  demoPainter: DemoPainter;
  organisationName: string | null;
  references: ReadonlyArray<{ label: string; value: string }> | null;
}) {
  const preview = buildProgressPreview(
    {
      contactName: snapshot.contactName ?? "",
      organisationName,
      jobAddress: snapshot.jobAddress ?? "",
      areas: (snapshot.areas ?? []).map((a) => ({ title: a.title, photos: a.photos ?? [] })),
      paints: (snapshot.paints ?? []).map((p) => ({ name: p.name, brand: p.brand, category: p.category, role: p.role, isPrep: p.isPrep })),
      references,
    },
    set,
    demoPainter,
  );
  if (!preview) return null;
  const sample = sampleTimeline(preview);
  return (
    <ProgressPhone
      preview={preview}
      feed={<JobTimeline project={SAMPLE_PROJECT} companyPhone="" sample={sample} />}
    />
  );
}
