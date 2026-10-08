"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { sniffKind } from "@/lib/extract/normalise";
import { stagedHeadBytes } from "@/lib/workorder/stagedBytes";
import { notifyPainterMessage } from "@/lib/contractor/notify";
import { staffPainterMessage } from "@/lib/staff/notify";
import {
  MESSAGE_BUCKET, MESSAGE_MAX_CHARS, MESSAGE_MAX_PHOTOS, MESSAGE_PHOTO_MAX_BYTES, MESSAGE_PHOTO_TYPES,
  photoObjectPath, photoPathOk, postErrorWords, type NotifyRecord,
} from "@/lib/workorder/messageModel";

/**
 * A project's messages between the office and one painter (Tom, 9 Oct 2026).
 * ONE set of actions for both sides — the PC job page and the painter's
 * portal. None of them decides who may do what: the session's own rights do
 * (storage policies, wo_message_post, wo_message_mark_read), so a painter
 * calling these for a job that isn't theirs is refused by the database.
 */

const ids = { workOrderId: z.string().uuid(), contractorId: z.string().uuid() };

export type SignPhotoResult = { ok: true; path: string; token: string } | { ok: false; message: string };

/** A signed upload slot in the thread's own folder. The photo goes straight from the phone to storage. */
export async function signMessagePhotoAction(raw: unknown): Promise<SignPhotoResult> {
  const parsed = z.object({
    ...ids,
    size: z.number().int().positive().max(MESSAGE_PHOTO_MAX_BYTES),
    contentType: z.enum(MESSAGE_PHOTO_TYPES),
  }).safeParse(raw);
  if (!parsed.success) {
    const tooBig = parsed.error.issues.some((i) => i.path[0] === "size");
    const wrongType = parsed.error.issues.some((i) => i.path[0] === "contentType");
    return { ok: false, message: tooBig ? `That photo is too big — up to ${MESSAGE_PHOTO_MAX_BYTES / 1024 / 1024} MB.`
      : wrongType ? "Only photos can go in a message — a JPEG, PNG, WebP or HEIC." : "That photo is missing which job it belongs to." };
  }
  const { workOrderId, contractorId, contentType } = parsed.data;
  const supabase = await createClient();
  const path = photoObjectPath(workOrderId, contractorId, contentType, Date.now(), randomUUID());
  // The storage policy's own question, asked first so a refusal is said in words.
  const { data: allowed, error: askErr } = await supabase.rpc("wo_message_object_ok", { p_name: path });
  if (askErr) {
    reportError(askErr, { where: "messages.sign.ownership", extra: { workOrderId } });
    return { ok: false, message: "Couldn't get the upload ready — try again in a moment." };
  }
  if (allowed !== true) return { ok: false, message: "That job isn't yours, so you can't add photos to its messages." };
  const { data, error } = await supabase.storage.from(MESSAGE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    reportError(error, { where: "messages.sign.slot", extra: { path } });
    return { ok: false, message: "Couldn't get the upload ready — try again in a moment." };
  }
  return { ok: true, path: data.path, token: data.token };
}

export type PostMessageResult =
  | { ok: true; messageId: string; notify: NotifyRecord | null; batched: boolean }
  | { ok: false; message: string };

/** Is a staged object really a photo? Read from the bytes, never from its name. */
async function isPhoto(supabase: Awaited<ReturnType<typeof createClient>>, path: string): Promise<boolean> {
  const bytes = await stagedHeadBytes(supabase, MESSAGE_BUCKET, path);
  const kind = bytes && bytes.length >= 12 ? sniffKind(bytes) : null;
  return kind !== null && kind !== "pdf";
}

export async function postMessageAction(raw: unknown): Promise<PostMessageResult> {
  const parsed = z.object({
    ...ids,
    body: z.string().max(MESSAGE_MAX_CHARS, `Keep it under ${MESSAGE_MAX_CHARS.toLocaleString("en-AU")} characters.`).transform((s) => s.trim()),
    photoPaths: z.array(z.string().max(200)).max(MESSAGE_MAX_PHOTOS, `Up to ${MESSAGE_MAX_PHOTOS} photos in one message.`).default([]),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? postErrorWords(null) };
  const { workOrderId, contractorId, body, photoPaths } = parsed.data;
  if (!body && photoPaths.length === 0) return { ok: false, message: postErrorWords("empty") };
  if (photoPaths.some((p) => !photoPathOk(p, workOrderId, contractorId))) return { ok: false, message: postErrorWords("bad_photo") };

  const supabase = await createClient();
  // The bytes, before anything is posted: a signed slot is permission to store
  // bytes, never a statement of what they are. A file that isn't a photo is
  // removed (server-side — painters cannot delete from the bucket).
  const checks = await Promise.all(photoPaths.map((p) => isPhoto(supabase, p)));
  const bad = photoPaths.filter((_, i) => !checks[i]);
  if (bad.length > 0) {
    const service = createServiceClient();
    if (service) {
      const { error: rmErr } = await service.storage.from(MESSAGE_BUCKET).remove(bad);
      if (rmErr) reportError(rmErr, { where: "messages.post.removeRejected", bestEffort: true, extra: { bad } });
    }
    return { ok: false, message: bad.length === 1 ? "One of those files isn't a photo we can show — take it again, or pick a JPEG or PNG." : "Some of those files aren't photos we can show — take them again, or pick JPEGs or PNGs." };
  }

  const { data, error } = await supabase.rpc("wo_message_post", {
    p_work_order_id: workOrderId, p_contractor_id: contractorId, p_body: body, p_photo_paths: photoPaths,
  });
  if (error) {
    reportError(error, { where: "messages.post", extra: { workOrderId, contractorId } });
    return { ok: false, message: postErrorWords(null) };
  }
  const r = (data ?? {}) as { ok?: boolean; error?: string; message_id?: string; side?: string; notify?: boolean };
  if (!r.ok || !r.message_id) return { ok: false, message: postErrorWords(r.error) };
  const messageId = r.message_id;

  const service = createServiceClient();
  if (r.side === "staff") {
    // The office waits for the answer: the box says in words whether the
    // painter was texted, held for sending hours, or not reached and why.
    if (!r.notify) return { ok: true, messageId, notify: null, batched: true };
    if (!service) {
      reportError(new Error("service client unavailable"), { where: "messages.post.notify" });
      return { ok: true, messageId, notify: { status: "skipped", detail: "Not sent — messaging isn't set up on this server." }, batched: false };
    }
    return { ok: true, messageId, notify: await notifyPainterMessage(service, messageId), batched: false };
  }
  // The painter doesn't wait on the office's alert; the PC card is the record.
  if (r.notify && service) after(() => staffPainterMessage(service, messageId).then(() => undefined));
  return { ok: true, messageId, notify: null, batched: !r.notify };
}

export type MarkReadResult = { ok: true } | { ok: false; message: string };

/** Seen it: your own side of the thread only. The PC work item clears on the staff side's read. */
export async function markThreadReadAction(raw: unknown): Promise<MarkReadResult> {
  const parsed = z.object({ threadId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Which conversation?" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_message_mark_read", { p_thread_id: parsed.data.threadId });
  if (error) {
    reportError(error, { where: "messages.markRead", bestEffort: true, extra: { threadId: parsed.data.threadId } });
    return { ok: false, message: "Couldn't mark it read just now." };
  }
  return String(data ?? "") === "ok" ? { ok: true } : { ok: false, message: "That conversation isn't yours." };
}
