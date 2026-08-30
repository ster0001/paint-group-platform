"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { templateSchema, type Template } from "@/lib/campaigns/blocks";
import { generateEmail } from "@/lib/campaigns/ai";
import { resolveRecipientLinks, sendCampaignEmail } from "@/lib/campaigns/send";
import { getSegment } from "@/lib/crm/segmentsStore";

export type StudioResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

const uuid = z.string().uuid();

export async function createTemplate(
  name: string,
  segmentKey: string | null,
  kind: "email" | "sms" = "email",
): Promise<StudioResult<{ id: string }>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("campaign_templates")
    .insert({
      name: name.trim() || (kind === "sms" ? "Untitled text" : "Untitled email"),
      segment_key: segmentKey, created_by: user?.id ?? null,
      ...(kind === "sms" ? { kind: "sms" } : {}),
    })
    .select("id")
    .single();
  if (error) {
    return { ok: false, message: kind === "sms" && /kind/.test(error.message)
      ? "Text templates need migration 20261212 — run it and try again."
      : error.message };
  }
  revalidatePath("/crm/campaigns/emails");
  return { ok: true, message: "Started.", data: { id: data.id as string } };
}

/**
 * Saving a TEXT template. Same approval hinge as email: any edit clears
 * approved_at, because a text somebody read and then changed is unread.
 */
export async function saveSmsTemplate(id: string, name: string, body: string): Promise<StudioResult> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a template." };
  const { SMS_MAX_CHARS } = await import("@/lib/campaigns/sms");
  const clean = body.trim();
  if (clean.length > SMS_MAX_CHARS) {
    return { ok: false, message: `Too long for a text — keep it under ${SMS_MAX_CHARS} characters, or write it as an email.` };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("campaign_templates").update({
    name: name.trim() || "Untitled text",
    sms_body: clean,
    approved_at: null,
    approved_by: null,
  }).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/crm/campaigns/emails/${id}`);
  revalidatePath("/crm/campaigns/emails");
  return { ok: true, message: "Saved." };
}

/**
 * A test text goes to the BUSINESS'S OWN phone from Settings — the same rule
 * as the email test only reaching the signed-in tester: a "text any number"
 * box is a send button with a thin disguise.
 */
export async function sendTestSms(id: string): Promise<StudioResult<{ to: string }>> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a template." };
  const supabase = await createClient();
  const [{ data: row }, { data: profileRow }] = await Promise.all([
    supabase.from("campaign_templates").select("sms_body").eq("id", id).maybeSingle(),
    supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle(),
  ]);
  if (!row) return { ok: false, message: "That template is gone." };
  const body = String(row.sms_body ?? "").trim();
  if (!body) return { ok: false, message: "There's nothing in it to send." };

  const company = (profileRow?.value ?? {}) as { name?: string; phone?: string };
  const { sendCampaignSms, toE164Au } = await import("@/lib/campaigns/sms");
  const to = toE164Au(company.phone);
  if (!to) {
    return { ok: false, message: "Settings → company profile needs a MOBILE number (04xx) for test texts — the company phone on file isn't one." };
  }
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://paintgroup.com.au").replace(/\/$/, "");
  const result = await sendCampaignSms({
    toRawPhone: company.phone,
    body: `[TEST] ${body}`,
    links: { estimateUrl: null, accountUrl: `${base}/account` },
    companyName: company.name || "Paint Group",
  });
  if (!result.ok) return { ok: false, message: result.error };
  return { ok: true, message: `Sent to ${to} — the company mobile.`, data: { to } };
}

/**
 * Save the draft.
 *
 * Any change clears `approved_at`: a template that was read and approved, then
 * edited, is not an approved template — and the send guard in the next session
 * reads that column.
 */
export async function saveTemplate(id: string, name: string, template: Template): Promise<StudioResult> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a template." };
  const parsed = templateSchema.safeParse(template);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; ") };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("campaign_templates").update({
    name: name.trim() || "Untitled email",
    subject: parsed.data.subject,
    preheader: parsed.data.preheader,
    blocks: parsed.data.blocks,
    approved_at: null,
    approved_by: null,
  }).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/crm/campaigns/emails/${id}`);
  revalidatePath("/crm/campaigns/emails");
  return { ok: true, message: "Saved." };
}

export async function approveTemplate(id: string): Promise<StudioResult> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a template." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("campaign_templates")
    .update({ approved_at: new Date().toISOString(), approved_by: user?.id ?? null })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/crm/campaigns/emails/${id}`);
  return { ok: true, message: "Marked as read and approved. Nothing sends yet — sending is the next session." };
}

export async function deleteTemplate(id: string): Promise<StudioResult> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a template." };
  const supabase = await createClient();
  const { error } = await supabase.from("campaign_templates").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm/campaigns/emails");
  return { ok: true, message: "Deleted." };
}

/**
 * "Write it for me".
 *
 * The facts list is the important input: the model may use those and nothing
 * else, and anything it says beyond them comes back as a warning on the draft.
 * Nothing is saved automatically — the writer sees it, then chooses.
 */
export async function writeWithAi(input: {
  goal: string;
  segmentKey: string | null;
  facts: string;
  ctaUrl: string;
  tone: "warm" | "plain" | "brief";
  existing?: Template | null;
}): Promise<StudioResult<{ template: Template; warnings: string[] }>> {
  const goal = input.goal.trim();
  if (goal.length < 8) return { ok: false, message: "Say what the email is for, in a sentence." };

  const supabase = await createClient();
  const { data: profileRow } = await supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const companyName = ((profileRow?.value ?? {}) as { name?: string }).name || "Paint Group";

  const segment = input.segmentKey ? await getSegment(supabase, input.segmentKey) : null;
  const audience = segment ? `${segment.name} — ${segment.description}` : "Past and prospective customers.";

  const result = await generateEmail({
    goal,
    audience,
    facts: input.facts.split("\n").map((f) => f.replace(/^[-•]\s*/, "").trim()).filter(Boolean),
    ctaUrl: input.ctaUrl.trim() || "https://paintgroup.com.au/estimate",
    companyName,
    tone: input.tone,
    existing: input.existing ?? null,
  });

  if (!result.ok) return { ok: false, message: result.error };
  return {
    ok: true,
    message: result.warnings.length
      ? `Draft written — ${result.warnings.length} thing${result.warnings.length === 1 ? "" : "s"} to check.`
      : "Draft written.",
    data: { template: result.template, warnings: result.warnings },
  };
}

/**
 * Send this draft to one address, as a test.
 *
 * The only path in the whole module that puts an email on the wire, and it can
 * only ever reach the person asking: the address is the signed-in staff
 * member's own, never typed in. A "send test to anyone" box is a send button
 * with a thin disguise.
 */
export async function sendTestEmail(id: string): Promise<StudioResult<{ to: string }>> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a template." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const to = user?.email ?? "";
  if (!to) return { ok: false, message: "You have no email address on your login." };

  const [{ data: row }, { data: profileRow }] = await Promise.all([
    supabase.from("campaign_templates").select("subject, preheader, blocks").eq("id", id).maybeSingle(),
    supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle(),
  ]);
  if (!row) return { ok: false, message: "That template is gone." };

  const parsed = templateSchema.safeParse({
    subject: row.subject ?? "",
    preheader: row.preheader ?? "",
    blocks: Array.isArray(row.blocks) ? row.blocks : [],
  });
  if (!parsed.success) return { ok: false, message: "Save the draft first — it isn't valid yet." };
  if (parsed.data.blocks.length === 0) return { ok: false, message: "There's nothing in it to send." };
  if (!parsed.data.subject.trim()) return { ok: false, message: "It needs a subject line first." };

  const company = (profileRow?.value ?? {}) as { name?: string; logoUrl?: string };

  // A test carries the STAFF member's own account id in the unsubscribe link,
  // if they have one — so clicking it in a test unsubscribes the tester and
  // nobody else. With no account, the link is inert.
  const { data: account } = await supabase.from("accounts").select("id").eq("email", to.toLowerCase()).maybeSingle();

  const result = await sendCampaignEmail({
    to,
    accountId: (account?.id as string) ?? "00000000-0000-0000-0000-000000000000",
    template: parsed.data,
    brand: { companyName: company.name || "Paint Group", logoUrl: company.logoUrl || null },
    isTest: true,
    // A test resolves the tokens against the TESTER, so the buttons in the
    // test email are clickable and honest about where they'd go.
    links: account?.id ? await resolveRecipientLinks(supabase, account.id as string) : undefined,
  });
  if (!result.ok) return { ok: false, message: result.error };
  return { ok: true, message: `Sent to ${to}. It'll say [TEST] in the subject.`, data: { to } };
}

/**
 * A photo INTO the email, from a file rather than a URL (Tom, 30 Aug: "it only
 * allows to add photos from html, I want to be able to upload photos here").
 *
 * Lands in the public campaign-media bucket, because email clients fetch
 * images with no credentials — a private bucket renders as broken squares in
 * every inbox. Staff-session upload, so the storage policy does the gating.
 */
export async function uploadCampaignPhoto(formData: FormData): Promise<StudioResult<{ url: string }>> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a photo first." };
  if (file.size > 10 * 1024 * 1024) return { ok: false, message: "Under 10 MB, please — an email photo bigger than that is a mistake either way." };
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return { ok: false, message: "A photo — JPG, PNG, WebP or GIF." };

  const supabase = await createClient();
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/gif" ? "gif" : "jpg";
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from("campaign-media")
    .upload(path, file, { contentType: file.type, cacheControl: "31536000" });
  if (error) {
    return { ok: false, message: /bucket/i.test(error.message)
      ? "The campaign-media bucket isn't there yet — run migration 20261211."
      : error.message };
  }
  const { data } = supabase.storage.from("campaign-media").getPublicUrl(path);
  return { ok: true, message: "Photo in.", data: { url: data.publicUrl } };
}
