"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { ensureProperty } from "@/lib/accounts/link";
import { reportError } from "@/lib/monitoring/report";

const inputSchema = z.object({
  street: z.string().trim().min(3, "The street address, please.").max(120),
  suburb: z.string().trim().max(80).default(""),
  state: z.string().trim().max(10).default(""),
  postcode: z.string().trim().max(10).default(""),
  makePrimary: z.boolean(),
});

/**
 * 3a-6 · Add an address (§3): one screen, and both addresses are kept either
 * way — a mover's old home stays in the account for good. "Replaces my main
 * address" only changes which property leads (accounts.flags.primaryPropertyId).
 */
export async function addAddressAction(formData: FormData): Promise<void> {
  const parsed = inputSchema.safeParse({
    street: String(formData.get("street") ?? ""),
    suburb: String(formData.get("suburb") ?? ""),
    state: String(formData.get("state") ?? ""),
    postcode: String(formData.get("postcode") ?? ""),
    makePrimary: formData.get("makePrimary") === "on",
  });
  if (!parsed.success) redirect("/account/addresses/new?error=address");

  const ctx = await getPortalContext();
  if (!ctx || ctx.accounts.length === 0) redirect("/account/login");
  const account = ctx!.accounts[0]; // single-account UI (⚑6)

  const svc = createServiceClient();
  if (!svc) redirect("/account/addresses/new?error=failed");

  try {
    const { propertyId } = await ensureProperty(svc!, account.id, {
      street: parsed.data!.street,
      suburb: parsed.data!.suburb,
      state: parsed.data!.state,
      postcode: parsed.data!.postcode,
    });
    if (!propertyId) redirect("/account/addresses/new?error=address");

    if (parsed.data!.makePrimary) {
      const { data: row } = await svc!.from("accounts").select("flags").eq("id", account.id).single();
      const flags = ((row?.flags ?? {}) as Record<string, unknown>);
      await svc!.from("accounts").update({ flags: { ...flags, primaryPropertyId: propertyId } }).eq("id", account.id);
    }
    redirect(`/account?property=${propertyId}`);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirects
    reportError(err, { where: "portal.addAddress" });
    redirect("/account/addresses/new?error=failed");
  }
}
