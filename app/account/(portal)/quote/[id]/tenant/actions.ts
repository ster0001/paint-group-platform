"use server";

import { z } from "zod";
import { getCompanyContact, getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { sendSms } from "@/lib/messaging/send";
import { reportError } from "@/lib/monitoring/report";
import { TENANT_ASKS, TENANT_LINK_DAYS, newTenantToken, tenantMessage } from "@/lib/portal/tenant-link";

/**
 * C15 (A4) — "Send the link": one `tenant_photo_links` row per send, a
 * token the tenant opens with no account, and the SMS when a number was
 * given. The agent sees what was sent (⚑61): the row's `sent_to` and
 * `asked_for` render on the page after the send.
 */
const inputSchema = z.object({
  estimateId: z.string().uuid(),
  phone: z.string().trim().max(40).default(""),
  askedFor: z.array(z.enum(TENANT_ASKS.map((a) => a.key) as [string, ...string[]])).max(8).default([]),
});

export type SendTenantLinkResult =
  | { ok: true; url: string; message: string; smsStatus: string }
  | { ok: false; message: string };

export async function sendTenantLink(raw: unknown): Promise<SendTenantLinkResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Check the number and try again." };
  const ctx = await getPortalContext();
  if (!ctx) return { ok: false, message: "Sign in again to send the link." };
  const svc = createServiceClient();
  if (!svc) return { ok: false, message: "Sending is unavailable right now." };

  const { data: est } = await svc.from("estimates").select("id, account_id, property_id, title").eq("id", parsed.data.estimateId).maybeSingle();
  if (!est || !ctx.accounts.some((a) => a.id === est.account_id)) return { ok: false, message: "That quote isn't yours to send from." };
  if (!est.property_id) return { ok: false, message: "This quote isn't pinned to a property yet — photos need somewhere to land." };

  const token = newTenantToken();
  const expiresAt = new Date(Date.now() + TENANT_LINK_DAYS * 86_400_000).toISOString();
  const ins = await svc.from("tenant_photo_links").insert({
    property_id: est.property_id, estimate_id: est.id, account_id: est.account_id,
    token, expires_at: expiresAt, requested_by: ctx.userId,
    sent_to: parsed.data.phone || null, asked_for: parsed.data.askedFor, status: "sent",
  });
  if (ins.error) {
    reportError(ins.error, { where: "tenantLink.insert", bestEffort: true });
    return { ok: false, message: "The link couldn't be made — try again in a moment." };
  }

  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const url = `${base}/photos/${token}`;
  const company = await getCompanyContact();
  const property = ctx.properties.find((p) => p.id === est.property_id);
  const address = [property?.address, property?.suburb].filter(Boolean).join(", ") || (est.title as string | null) || "the property";
  const message = tenantMessage({
    companyName: company.name, agencyName: ctx.accounts.find((a) => a.account_type === "trade")?.name ?? null, address, url,
  });

  let smsStatus = "not_sent";
  if (parsed.data.phone) {
    const r = await sendSms({ to: parsed.data.phone, body: message, ctx: { accountId: est.account_id as string, estimateId: est.id as string } });
    smsStatus = r.status;
  }
  return { ok: true, url, message, smsStatus };
}
