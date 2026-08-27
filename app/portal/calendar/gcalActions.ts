"use server";

import { revalidatePath } from "next/cache";
import { requireContractor } from "@/lib/contractor/session";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteGcalConnection, reconcileContractorCalendar } from "@/lib/gcal/sync";

/** Disconnect Google Calendar: revoke the token and forget the connection.
 *  The "Paint Group Jobs" calendar stays in their Google account — deleting
 *  a calendar out of someone's Google account is theirs to do, not ours. */
export async function disconnectGoogleCalendar(): Promise<string> {
  const session = await requireContractor();
  const admin = createServiceClient();
  if (!session.contractor || !admin) return "error:unavailable";
  await deleteGcalConnection(admin, session.contractor.id);
  revalidatePath("/portal/calendar");
  return "ok";
}

/** Manual "sync now" — the same reconciler every trigger uses. */
export async function syncGoogleCalendarNow(): Promise<string> {
  const session = await requireContractor();
  if (!session.contractor) return "error:unavailable";
  const result = await reconcileContractorCalendar(session.contractor.id);
  revalidatePath("/portal/calendar");
  return result.status === "synced" ? "ok" : `error:${"message" in result ? result.message : result.status}`;
}
