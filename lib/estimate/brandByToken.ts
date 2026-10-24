import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { messageBrandOf, type MessageBrand } from "@/lib/messaging/brand";

/**
 * Paint Home brief §5: which brand an estimate belongs to, by its share
 * token — for the customer's /e page and its tab title. One service read of
 * the one column; the token RPC's payload is the sent snapshot and carries
 * no brand. A failed read is reported and answers Paint Group (the default
 * every row has), never a blank page.
 */
export async function estimateBrandByToken(token: string): Promise<MessageBrand> {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) return "paintgroup";
  const svc = createServiceClient();
  if (!svc) return "paintgroup";
  const { data, error } = await svc.from("estimates").select("brand").eq("share_token", token).maybeSingle();
  if (error) {
    reportError(error, { where: "estimate.brandByToken", bestEffort: true });
    return "paintgroup";
  }
  return messageBrandOf((data as { brand?: unknown } | null)?.brand);
}
