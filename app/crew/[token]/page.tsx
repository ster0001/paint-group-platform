import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { WorkOrderDoc as WODoc } from "@/lib/workorder/snapshot";
import { crewDoc, type CrewVariation } from "@/lib/workorder/crew";
import { ticksBySurfaceKey, type SurfaceState } from "@/lib/workorder/surfaces";
import WorkOrderDoc from "@/app/w/WorkOrderDoc";
import { createServiceClient } from "@/lib/supabase/service";
import { signPhotos, type WOPhoto, type WOPhotoRow } from "@/lib/workorder/photos";

export const dynamic = "force-dynamic";

/**
 * The crew's job sheet — /crew/[token], token-only, no login.
 *
 * Same pattern as /w/[token], one level further down the trust ladder: the
 * contractor mints this link from their portal and hands it to their painters.
 * The document is stripped to the crew whitelist HERE, on the server, so the
 * payload never carries the contractor's payment or the customer's phone —
 * and the Download PDF button on the page prints this already-stripped view,
 * which is what makes the PDF safe for free.
 *
 * View-only: this route has no tick RPC and no actions. Ticking stays with
 * the contractor, whose name is on the accountability trail.
 */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_work_order_by_crew_token", { p_token: token });
  const row = (Array.isArray(data) ? data[0] : data) as
    { snapshot: WODoc | null; status: string; start_date: string | null } | undefined;
  if (error || !row?.snapshot || (row.snapshot as Partial<WODoc>).version !== 1) notFound();

  // Live ticks so the sheet shows real progress; degrades to the frozen
  // statuses rather than failing the page.
  const { data: tickRows } = await supabase.rpc("get_work_order_ticks_by_crew_token", { p_token: token });
  const ticks = ticksBySurfaceKey(
    (tickRows as { surface_key: string | null; state: SurfaceState }[] | null) ?? [],
  );

  // Variations: the scope of what changed on site. The RPC's return type has
  // no money columns, so there is nothing here to strip.
  const { data: varRows } = await supabase.rpc("get_work_order_variations_by_crew_token", { p_token: token });
  const variations: CrewVariation[] = ((varRows as
    { category: string; comment: string; est_hours: number | null; status: string }[] | null) ?? [])
    .map((v) => ({ category: v.category, comment: v.comment, estHours: v.est_hours, status: v.status }));

  // The office's reference photos (20270190/91): an instruction about the work
  // is exactly what the crew whitelist carries. The crew token has already
  // been proved above; the RPC returns only reference rows for that job, as
  // PATHS, and the service client signs only what the RPC allowed. A failure
  // here degrades to no photos rather than failing the crew's sheet.
  const { data: officeRows, error: officeErr } = await supabase
    .rpc("get_work_order_office_photos_by_crew_token", { p_token: token });
  const svc = createServiceClient();
  let officePhotos: WOPhoto[] = [];
  if (!officeErr && svc && (officeRows as unknown[] | null)?.length) {
    officePhotos = await signPhotos(
      svc, (officeRows as WOPhotoRow[]).map((r) => ({ ...r, kind: "reference" })),
    );
  }

  const doc = crewDoc({
    ...row.snapshot,
    status: row.status ?? row.snapshot.status,
    startDate: row.start_date ?? row.snapshot.startDate,
  });

  return <WorkOrderDoc doc={doc} ticks={ticks} variant="crew" crewVariations={variations} photos={officePhotos} />;
}
