"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendHold, type HoldRow } from "@/lib/automations/dispatch";

/**
 * "Messages to approve" — the office's three buttons on an automatic job
 * message the settings said to approve first (Session 1). Approve sends it
 * now (re-checking the switch and whether it is still needed), Edit then
 * send takes new wording, Skip records why and sends nothing. Staff only —
 * the session decides; the service client does the send because the send
 * layer has no session.
 */
export type QueueResult = { ok: boolean; message: string };

const uuid = z.string().uuid();
const edits = z.object({
  subject: z.string().trim().max(200).optional(),
  bodyText: z.string().trim().max(20_000).optional(),
  smsBody: z.string().trim().max(1_600).optional(),
});

async function staffAndHold(id: string): Promise<{ ok: true; hold: HoldRow; userId: string } | { ok: false; message: string }> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a message." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };
  // Read through the session: RLS says whether this person may see it.
  const { data } = await supabase.from("automation_holds").select("*").eq("id", id).maybeSingle();
  if (!data) return { ok: false, message: "That message is gone." };
  const hold = data as HoldRow;
  if (hold.status !== "pending" && hold.status !== "held") return { ok: false, message: `Already ${hold.status}.` };
  return { ok: true, hold, userId: user.id };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain paragraphs → the same simple HTML the branded emails use for their body. */
function paragraphs(text: string): string {
  return text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

export async function approveHold(id: string, input?: z.input<typeof edits>): Promise<QueueResult> {
  const got = await staffAndHold(id);
  if (!got.ok) return got;
  const svc = createServiceClient();
  if (!svc) return { ok: false, message: "Sending is unavailable right now." };
  const e = input ? edits.safeParse(input) : null;
  if (e && !e.success) return { ok: false, message: "Check the wording and try again." };
  const changes = e?.success ? e.data : undefined;
  // An edited body replaces the message text inside the stored HTML when the
  // template marker is present; otherwise the plain paragraphs are sent as a
  // simple branded email so nothing the office wrote is lost.
  let bodyHtml: string | undefined;
  if (changes?.bodyText && got.hold.body_html) {
    const marker = /<!--BODY-->[\s\S]*?<!--\/BODY-->/;
    bodyHtml = marker.test(got.hold.body_html)
      ? got.hold.body_html.replace(marker, `<!--BODY-->${paragraphs(changes.bodyText)}<!--/BODY-->`)
      : paragraphs(changes.bodyText);
  }
  const r = await sendHold(svc, got.hold, { decidedBy: got.userId, edits: { subject: changes?.subject, bodyHtml, smsBody: changes?.smsBody } });
  revalidatePath("/crm/messages/queue");
  revalidatePath("/crm/today");
  if (r === "sent") return { ok: true, message: "Sent." };
  if (r === "skipped") return { ok: true, message: "Not sent — it is no longer needed (the reason is on the row)." };
  return { ok: false, message: "The send failed — the details are on the row." };
}

export async function approveHolds(ids: string[]): Promise<QueueResult> {
  let sent = 0, other = 0;
  for (const id of ids.slice(0, 50)) {
    const r = await approveHold(id);
    if (r.ok && r.message === "Sent.") sent += 1; else other += 1;
  }
  return { ok: true, message: `${sent} sent${other ? `, ${other} not sent (see the rows)` : ""}.` };
}

export async function skipHold(id: string, reason: string): Promise<QueueResult> {
  const got = await staffAndHold(id);
  if (!got.ok) return got;
  const supabase = await createClient();
  const { error } = await supabase.from("automation_holds")
    .update({ status: "skipped", decided_by: got.userId, decided_at: new Date().toISOString(), result: { reason: reason.trim().slice(0, 300) || "Skipped by the office." } })
    .eq("id", id);
  revalidatePath("/crm/messages/queue");
  revalidatePath("/crm/today");
  return error ? { ok: false, message: "Couldn't skip it just now." } : { ok: true, message: "Skipped — nothing was sent." };
}
