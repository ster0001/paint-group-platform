import { createClient } from "@/lib/supabase/server";
import { OFFER_COLUMNS, suburbOnly, type BookingOffer } from "@/lib/scheduling/offers";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";

// Server-only reader for the contractor's booking offers.

export type OfferWithJob = {
  offer: BookingOffer;
  woRef: string;
  /** Contractor-safe document — address, title and customer contact are
   *  redacted HERE, on the server, until the offer is accepted (Tom, 25 Aug:
   *  the raw snapshot used to reach the browser and only the render hid it). */
  doc: WorkOrderDoc | null;
};

/**
 * The contractor's offers, newest first. Sweeps lapsed offers first so a stale
 * one can never be presented as live — the sweep is idempotent and cheap.
 */
export async function listContractorOffers(contractorId: string): Promise<OfferWithJob[]> {
  const supabase = await createClient();
  await supabase.rpc("expire_booking_offers").then(
    () => {},
    () => {},
  );

  const { data } = await supabase
    .from("booking_offers")
    .select(`${OFFER_COLUMNS}, work_orders ( wo_ref, wo_snapshot )`)
    .eq("contractor_id", contractorId)
    .order("offered_at", { ascending: false });

  type Joined = BookingOffer & { work_orders: { wo_ref: string; wo_snapshot: unknown } | null };
  return ((data as Joined[] | null) ?? []).map((r) => {
    const { work_orders, ...offer } = r;
    const snap = work_orders?.wo_snapshot as WorkOrderDoc | null;
    let doc = snap && (snap as Partial<WorkOrderDoc>).version === 1 ? snap : null;
    if (doc && offer.state !== "accepted") {
      doc = {
        ...doc,
        jobAddress: suburbOnly(doc.jobAddress),
        jobTitle: suburbOnly(doc.jobAddress),
        contactFirstName: "",
        contactPhone: "",
      };
    }
    return {
      offer: offer as BookingOffer,
      woRef: work_orders?.wo_ref ?? "",
      doc,
    };
  });
}
