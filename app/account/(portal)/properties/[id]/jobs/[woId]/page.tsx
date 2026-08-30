import { notFound, redirect } from "next/navigation";
import { getPortalContext, getPortalProjectByWorkOrder } from "@/lib/portal/data";
import { getTradeTimelineEvents } from "@/lib/portal/tradeData";
import JobTimeline from "../../../../JobTimeline";

export const dynamic = "force-dynamic";

/**
 * Trade portal v2 · Session 4 — the job timeline, scoped organisation →
 * property → job. The SAME JobTimeline component the residential portal
 * renders (§5.3: never fork it); only the scoping and the back link differ,
 * plus the trade-only events threaded through the same feed. Anything out
 * of scope — wrong org, wrong property, a property outside the viewer's
 * property_scope — is a 404, never a 403.
 */
export default async function TradeJobTimelinePage({ params }: { params: Promise<{ id: string; woId: string }> }) {
  const { id, woId } = await params;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");
  if (!ctx.accounts.some((a) => a.account_type === "trade")) redirect("/account");

  // Property scope first: ctx.properties is the member's own RLS-scoped view
  // (property_scope narrows it), so an out-of-scope property never resolves.
  const property = ctx.properties.find((p) => p.id === id);
  if (!property) notFound();

  const result = await getPortalProjectByWorkOrder(ctx.accounts.map((a) => a.id), woId);
  if (!result || result.propertyId !== id) notFound();

  const tradeEvents = await getTradeTimelineEvents(woId, result.project.estimateId);
  const address = [property.address, property.suburb].filter(Boolean).join(", ") || "this property";

  return (
    <JobTimeline
      project={result.project}
      companyPhone={ctx.companyPhone}
      backLink={{ href: `/account/properties/${id}`, label: address }}
      tradeEvents={tradeEvents}
    />
  );
}
