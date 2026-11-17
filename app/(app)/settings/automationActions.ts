"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AUTOMATIONS, automationByKey } from "@/lib/automations/registry";
import { SAMPLE_VARS } from "@/lib/automations/controls";
import { DEFAULT_MESSAGING, normalisePhoneAU, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { buildPlainEmailHtml, sendEmail, sendSms } from "@/lib/messaging/send";
import { loadMessaging } from "@/lib/messaging/load";
import { emailLogoUrl } from "@/lib/messaging/logo";

/**
 * "Send test to me" on Settings → Automations (Session 1). Renders the
 * wording AS TYPED (unsaved edits included) with the example job, and sends
 * it to the signed-in staff member only — their login email, and the mobile
 * on their staff profile. Never to an address typed in: a test that can
 * reach anyone is a send button in disguise. Not recorded in `messages`.
 */
export type TestResult = { ok: boolean; message: string };

const input = z.object({
  key: z.string().min(1).max(80),
  channel: z.enum(["email", "sms"]),
  /** The template fields as they read on screen right now. */
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export async function sendTestAutomation(raw: z.input<typeof input>): Promise<TestResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That test couldn't be built." };
  const { key, channel, fields } = parsed.data;
  const a = automationByKey(key);
  if (!a) return { ok: false, message: "Unknown automation." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };
  const { data: profile } = await supabase.from("profiles").select("role, phone, name").eq("id", user.id).maybeSingle();
  const p = profile as { role?: string; phone?: string | null; name?: string | null } | null;
  if (p?.role !== "staff") return { ok: false, message: "Staff only." };

  const { messaging, company } = await loadMessaging(supabase);
  const cfg: MessagingSettings = { ...messaging, ...(fields as Partial<MessagingSettings>) };
  const vars = { ...SAMPLE_VARS, company_name: company.name || SAMPLE_VARS.company_name };
  const tpl = (kind: "subject" | "body" | "sms") => a.templates?.find((t) => t.kind === kind);

  if (channel === "sms") {
    const t = tpl("sms");
    if (!t) return { ok: false, message: "This automation has no text message." };
    const to = p?.phone ? normalisePhoneAU(p.phone) : null;
    if (!to) return { ok: false, message: "Add a mobile to your staff profile (Settings → Staff logins) to test texts." };
    const body = `[TEST] ${renderTemplate(String(cfg[t.field] ?? ""), vars)}`;
    const r = await sendSms({ to, body, ctx: { skipRecord: true } });
    return r.status === "sent" ? { ok: true, message: `Test text sent to ${to}.` }
      : r.status === "not_configured" ? { ok: false, message: "Texts are not configured on this server (Twilio)." }
      : { ok: false, message: "message" in r ? r.message : "The text failed." };
  }

  const s = tpl("subject");
  const b = tpl("body");
  if (!s && !b) return { ok: false, message: "This automation has no email." };
  const to = user.email ?? "";
  if (!to) return { ok: false, message: "Your login has no email address." };
  const subject = `[TEST] ${renderTemplate(String((s ? cfg[s.field] : "") ?? DEFAULT_MESSAGING.emailSubject), vars)}`;
  const body = renderTemplate(String((b ? cfg[b.field] : "") ?? ""), vars);
  const html = buildPlainEmailHtml({ heading: subject.replace(/^\[TEST\] /, ""), message: body, companyName: company.name || "Paint Group", logoUrl: emailLogoUrl(company), companyPhone: company.phone });
  const r = await sendEmail({ to, subject, html, ctx: { skipRecord: true } });
  return r.status === "sent" ? { ok: true, message: `Test email sent to ${to}.` }
    : r.status === "not_configured" ? { ok: false, message: "Email is not configured on this server (Resend)." }
    : { ok: false, message: "message" in r ? r.message : "The email failed." };
}

// ---- Paint Home wording (A‑B, 17 Nov 2026) ----------------------------------

const wordingInput = z.object({
  brand: z.literal("painthome"),
  /** field → text; a blank text removes the Paint Home row, so the Paint Group wording is used. */
  fields: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{1,79}$/), z.string().max(4000)),
});

export async function saveBrandWording(raw: z.input<typeof wordingInput>): Promise<TestResult> {
  const parsed = wordingInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That wording couldn't be saved." };
  const { brand, fields } = parsed.data;
  // Only real template fields of the registry — never an arbitrary settings key.
  const known = new Set(AUTOMATIONS.flatMap((a) => (a.templates ?? []).filter((t) => t.kind !== "number").map((t) => String(t.field))));
  if (Object.keys(fields).some((f) => !known.has(f))) return { ok: false, message: "That isn't a wording field." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };
  const { data: profile, error: pErr } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (pErr) return { ok: false, message: "That didn't save — try again." };
  if ((profile as { role?: string } | null)?.role !== "staff") return { ok: false, message: "Staff only." };

  const keep = Object.entries(fields).filter(([, body]) => body.trim());
  const drop = Object.entries(fields).filter(([, body]) => !body.trim()).map(([f]) => f);
  if (keep.length) {
    const { error } = await supabase.from("automation_brand_wording")
      .upsert(keep.map(([field, body]) => ({ brand, field, body, updated_at: new Date().toISOString(), updated_by: user.id })), { onConflict: "brand,field" });
    if (error) return { ok: false, message: "That didn't save — try again." };
  }
  if (drop.length) {
    const { error } = await supabase.from("automation_brand_wording").delete().eq("brand", brand).in("field", drop);
    if (error) return { ok: false, message: "That didn't save — try again." };
  }
  return { ok: true, message: "Paint Home wording saved ✓" };
}
