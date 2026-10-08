/**
 * Messages between the office and a painter, per project (Tom, 9 Oct 2026) —
 * the CLIENT-SAFE half: limits, the photo folder, the burst rule's twin and
 * the words a screen shows. Migration 20270249 is the authority; the
 * contract test (messageModel.test.ts) pins these to it.
 *
 * One thread per (work order, painter). Staff read every thread; a painter
 * reads only their own, on a job they are on. Every write is a database
 * function — nothing here decides who may post.
 */
import type { DispatchOutcome } from "@/lib/automations/dispatch";
import type { DeliveryResult } from "@/lib/messaging/send";

export const MESSAGE_MAX_CHARS = 4000;
export const MESSAGE_MAX_PHOTOS = 6;
/** = the wo-messages bucket's file_size_limit (25 MB), and MAX_UPLOAD_BYTES. */
export const MESSAGE_PHOTO_MAX_BYTES = 25 * 1024 * 1024;
export const MESSAGE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const MESSAGE_BUCKET = "wo-messages";
/**
 * One notification per burst: the other side is told when nobody has told
 * them on this thread yet, the last telling was this long ago or more, or
 * they have read the thread since it. Twin of wo_message_ping_due().
 */
export const MESSAGE_BURST_MINUTES = 10;

export type MessageSide = "staff" | "painter";
export type MessageMode = "staff" | "painter";

export function pingDue(pingedAt: string | null, readAt: string | null, now: Date): boolean {
  if (!pingedAt) return true;
  const pinged = new Date(pingedAt).getTime();
  if (pinged <= now.getTime() - MESSAGE_BURST_MINUTES * 60_000) return true;
  return readAt !== null && new Date(readAt).getTime() >= pinged;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The thread's own folder: "<work_order_id>/<contractor_id>/". */
export function threadFolder(workOrderId: string, contractorId: string): string {
  return `${workOrderId}/${contractorId}/`;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
};

/** A new object name inside the thread's folder. `stamp` + `rand` keep it unique; nothing else in it. */
export function photoObjectPath(workOrderId: string, contractorId: string, contentType: string, stamp: number, rand: string): string {
  const ext = EXT[contentType] ?? "jpg";
  return `${threadFolder(workOrderId, contractorId)}${stamp}-${rand.replace(/[^a-z0-9]/gi, "").slice(0, 12)}.${ext}`;
}

/** True when a path is a file directly inside this thread's folder — the same test wo_message_post makes. */
export function photoPathOk(path: string, workOrderId: string, contractorId: string): boolean {
  if (!UUID.test(workOrderId) || !UUID.test(contractorId)) return false;
  const folder = threadFolder(workOrderId, contractorId);
  if (!path.startsWith(folder)) return false;
  return /^[A-Za-z0-9._-]{1,80}$/.test(path.slice(folder.length));
}

/** What the database said no to, in words a painter or the office can act on. */
export const POST_ERROR_WORDS: Record<string, string> = {
  not_signed_in: "You've been signed out — sign in again and resend.",
  bad_input: "That message is missing which job it belongs to.",
  not_on_job: "That painter isn't on this job any more, so the message can't go to them.",
  not_yours: "That job isn't yours, so you can't message about it.",
  too_long: `Keep it under ${MESSAGE_MAX_CHARS.toLocaleString("en-AU")} characters.`,
  too_many_photos: `Up to ${MESSAGE_MAX_PHOTOS} photos in one message.`,
  empty: "Write something or add a photo first.",
  bad_photo: "One of the photos didn't upload properly — remove it and add it again.",
};

export function postErrorWords(code: string | null | undefined): string {
  return (code && POST_ERROR_WORDS[code]) || "Couldn't send that just now — check your signal and try again.";
}

/** The project a thread belongs to, as a painter sees it: the job ref and the suburb, nothing else. */
export function painterJobLabel(woRef: string, suburb: string): string {
  return [woRef.trim(), suburb.trim()].filter(Boolean).join(" · ");
}

export type NotifyRecord = { status: "sent" | "queued" | "skipped" | "off"; detail: string };

/**
 * What telling the painter came to, from the dispatcher's own outcome — never
 * from the attempt (Tom, 7 Oct 2026, 12A Cavell Court: a "notified" over no
 * message at all). Only a channel that actually SENT counts as sent.
 */
export function painterNotifyRecord(d: DispatchOutcome, firstName: string): NotifyRecord {
  const who = firstName && firstName !== "there" ? firstName : "the painter";
  if (d.outcome === "off") return { status: "off", detail: "Not texted — the “Message from the office” automation is switched off." };
  if (d.outcome === "nobody") return { status: "skipped", detail: `Not sent — ${who} has no mobile or email on file. ${d.detail}`.trim() };
  if (d.outcome === "error") return { status: "skipped", detail: `Not sent — ${d.message}` };
  if (d.outcome === "pending") return { status: "queued", detail: `Waiting for approval in Messages to approve before it goes to ${who}.` };
  if (d.outcome === "held") {
    const when = new Date(d.releaseAt).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", hour: "numeric", minute: "2-digit" });
    return { status: "queued", detail: `Outside sending hours — ${who} is texted at ${when}.` };
  }
  const results = Object.entries(d.results).filter((e): e is [string, DeliveryResult] => Boolean(e[1]));
  const sent = results.filter(([, r]) => r.status === "sent").map(([ch]) => ch);
  if (sent.length > 0) {
    const how = sent.includes("sms") && sent.includes("email") ? "Texted and emailed" : sent.includes("sms") ? "Texted" : "Emailed";
    return { status: "sent", detail: `${how} to ${who}${d.fallback ? ` (${d.fallback})` : ""}.` };
  }
  const why = results.map(([ch, r]) => {
    const label = ch === "sms" ? "Text" : "Email";
    return r.status === "not_configured" ? `${label}: not set up on this server` : `${label}: ${"message" in r ? r.message : r.status}`;
  }).join(" · ");
  return { status: "skipped", detail: `Nothing went out — ${why || "no channel was tried"}.` };
}

/** The line under a staff message, for the office. Painters never see it. */
export function notifyLine(status: string | null, detail: string): string | null {
  if (status === "batched") return "Covered by the text that just went — one per 10 minutes.";
  if (!status) return null;
  return detail || null;
}

/** "Thu 9 Oct, 2:14 pm" in Melbourne, whatever the server's zone. */
export function messageWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });
}
