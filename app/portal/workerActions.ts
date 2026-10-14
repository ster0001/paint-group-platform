"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { mintMagicLinkUrl } from "@/lib/portal/auth";
import { sendAutomation } from "@/lib/automations/dispatch";
import { loadMessaging } from "@/lib/messaging/load";
import { normalisePhoneAU, renderTemplate } from "@/lib/messaging/config";
import { suburbFromAddress } from "@/lib/automations/sweeps/moneySignoff";
import { siteUrl } from "@/lib/invoicing/pdf";
import { getContractorSession } from "@/lib/contractor/session";

/**
 * A contractor's crew (induction Step 3a, rulings 13–15): add a worker by
 * name and mobile, text them their login, share and unshare jobs, remove
 * them. Every write is a 20270265 RPC; the only thing the server does
 * itself is make the auth user — a worker has no email, so the login is a
 * one-time link texted to their phone, redeemed at /account/auth like a
 * customer's.
 *
 * The auth user's address is synthetic and never mailed: worker-<id>@workers.<domain>.
 */
type Result = { ok: true; message: string; id?: string } | { ok: false; message: string };

const WORKER_DOMAIN = "workers.paintgroup.com.au";

function plain(r: string): string {
  const map: Record<string, string> = {
    "error:not_a_contractor": "Only a contractor can manage a crew.",
    "error:employee": "Employed painters do not manage a crew — the office assigns jobs.",
    "error:no_name": "Give the worker a name.",
    "error:is_a_contractor": "That login is already a contractor.",
    "error:not_yours": "That is not yours.",
    "error:not_your_worker": "That worker is not on your crew.",
    "error:no_worker": "That worker was removed.",
    "error:not_inducted": "That worker has not finished the worker induction yet.",
  };
  return map[r] ?? `Couldn't do that (${r.replace("error:", "")}).`;
}

async function textLogin(workerProfileId: string, contractorUserId: string, mobile: string, contractorFirstName: string): Promise<string> {
  const service = createServiceClient();
  if (!service) return "no messaging on this server";
  const phone = normalisePhoneAU(mobile);
  if (!phone) return "no mobile";
  const { data: u } = await service.auth.admin.getUserById(workerProfileId);
  const email = u.user?.email;
  if (!email) return "no login";
  const link = await mintMagicLinkUrl(service, email, "/portal");
  if (!link) return "link not minted";
  const { messaging, company } = await loadMessaging(service);
  const body = renderTemplate(messaging.workerInviteSms, { first_name: contractorFirstName, company_name: company.name, link, version: "" });
  const o = await sendAutomation(service, { key: "contractor_worker_invite", to: { phone }, sms: { body }, ctx: { kind: "worker_invite" } });
  await service.from("contractor_users").update({ last_link_sent_at: new Date().toISOString() }).eq("id", contractorUserId);
  return o.outcome === "sent" ? "sent" : o.outcome === "error" ? o.message : o.outcome;
}

export async function addWorkerAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ name: z.string().trim().min(1).max(120), mobile: z.string().trim().min(6).max(40) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "A name and a mobile number, please." };
  const { contractor, name: myName } = await getContractorSession();
  if (!contractor) return { ok: false, message: "Only a contractor can add a worker." };
  const service = createServiceClient();
  if (!service) return { ok: false, message: "Logins can't be made on this server." };
  const phone = normalisePhoneAU(parsed.data.mobile);
  if (!phone) return { ok: false, message: "That mobile number doesn't look right." };

  // One auth user per worker, confirmed, no password: their login is the texted link.
  const email = `worker-${crypto.randomUUID().slice(0, 12)}@${WORKER_DOMAIN}`;
  const created = await service.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name: parsed.data.name }, phone: undefined });
  if (created.error || !created.data.user) { reportError(created.error, { where: "worker.add.createUser" }); return { ok: false, message: "Couldn't make the login — it has been reported." }; }
  const profileId = created.data.user.id;
  const { error: pErr } = await service.from("profiles").update({ role: "contractor", name: parsed.data.name, contact: phone }).eq("id", profileId);
  if (pErr) { reportError(pErr, { where: "worker.add.profile" }); return { ok: false, message: "Couldn't set the login up — it has been reported." }; }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("worker_register", { p_profile_id: profileId, p_name: parsed.data.name, p_mobile: phone, p_contractor_id: null });
  if (error) { reportError(error, { where: "worker.add.register" }); return { ok: false, message: "Couldn't add them — it has been reported." }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: plain(r) };
  const outcome = await textLogin(profileId, r.slice(3), phone, myName.split(" ")[0] || "Your contractor");
  revalidatePath("/portal/profile"); revalidatePath("/portal/jobs", "layout");
  return { ok: true, id: r.slice(3), message: outcome === "sent" ? `${parsed.data.name} is on your crew — their login link has been texted.` : `${parsed.data.name} is on your crew. The login text ${outcome === "off" ? "is switched off" : `did not go (${outcome})`} — press Send the link again.` };
}

export async function resendWorkerLinkAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ contractorUserId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that." };
  const { contractor, name: myName } = await getContractorSession();
  if (!contractor) return { ok: false, message: "Only a contractor can do that." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("contractor_users").select("id, profile_id, mobile, removed_at").eq("id", parsed.data.contractorUserId).maybeSingle();
  if (error) { reportError(error, { where: "worker.resend.read" }); return { ok: false, message: "Couldn't read that worker — it has been reported." }; }
  const w = data as { id: string; profile_id: string; mobile: string; removed_at: string | null } | null;
  if (!w || w.removed_at) return { ok: false, message: "That worker is not on your crew." };
  const outcome = await textLogin(w.profile_id, w.id, w.mobile, myName.split(" ")[0] || "Your contractor");
  revalidatePath("/portal/profile");
  return outcome === "sent" ? { ok: true, message: "Login link texted." } : { ok: false, message: `The text did not go (${outcome}).` };
}

export async function removeWorkerAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ contractorUserId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("worker_remove", { p_contractor_user_id: parsed.data.contractorUserId });
  if (error) { reportError(error, { where: "worker.remove" }); return { ok: false, message: "Couldn't remove them — it has been reported." }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: plain(r) };
  revalidatePath("/portal/profile"); revalidatePath("/portal/jobs", "layout");
  return { ok: true, message: "Removed. Their login no longer opens any of your jobs." };
}

/**
 * "I will add this later" for the certificates (induction Step 3b, ruling I5):
 * the painter's own row, one RPC, one contractor_events row; the reminder
 * ladder (certificate_rules) starts from now.
 */
export async function deferCertificatesAction(): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contractor_defer_certificates");
  if (error) { reportError(error, { where: "certificates.defer" }); return { ok: false, message: "Couldn't save that — it has been reported." }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: plain(r) };
  revalidatePath("/portal"); revalidatePath("/portal/profile");
  return { ok: true, message: "Noted — we will remind you. Job offers start once your certificate is in." };
}

export async function shareJobAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ workOrderId: z.string().uuid(), contractorUserId: z.string().uuid(), on: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that." };
  const { name: myName } = await getContractorSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("worker_share", { p_work_order_id: parsed.data.workOrderId, p_contractor_user_id: parsed.data.contractorUserId, p_on: parsed.data.on });
  if (error) { reportError(error, { where: "worker.share" }); return { ok: false, message: "Couldn't change that — it has been reported." }; }
  const r = String(data ?? "");
  if (!r.startsWith("ok:")) return { ok: false, message: plain(r) };
  revalidatePath(`/portal/jobs/${parsed.data.workOrderId}`);
  if (parsed.data.on) {
    // The worker is told, by text, with the job link.
    const service = createServiceClient();
    if (service) {
      const [{ data: w, error: wErr }, { data: wo, error: woErr }] = await Promise.all([
        service.from("contractor_users").select("mobile").eq("id", parsed.data.contractorUserId).maybeSingle(),
        service.from("work_orders").select("wo_ref, wo_snapshot").eq("id", parsed.data.workOrderId).maybeSingle(),
      ]);
      if (wErr || woErr) reportError(wErr ?? woErr, { where: "worker.share.text", bestEffort: true, extra: { workOrderId: parsed.data.workOrderId } });
      const phone = normalisePhoneAU((w as { mobile: string } | null)?.mobile ?? "");
      const job = wo as { wo_ref: string; wo_snapshot: { jobAddress?: string } | null } | null;
      if (phone && job) {
        const { messaging, company } = await loadMessaging(service);
        const body = renderTemplate(messaging.workerJobSharedSms, {
          first_name: myName.split(" ")[0] || "Your contractor", company_name: company.name, wo_ref: job.wo_ref,
          suburb: suburbFromAddress(job.wo_snapshot?.jobAddress, job.wo_ref), day_label: "", link: `${siteUrl()}/portal/jobs/${parsed.data.workOrderId}`,
        });
        await sendAutomation(service, { key: "contractor_worker_job_shared", to: { phone }, sms: { body }, ctx: { workOrderId: parsed.data.workOrderId, kind: "worker_job_shared" } });
      }
    }
  }
  return { ok: true, message: parsed.data.on ? "Shared — they have been texted the job." : "Unshared." };
}
