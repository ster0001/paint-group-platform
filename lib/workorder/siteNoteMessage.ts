import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyPainterMessage } from "@/lib/contractor/notify";
import { reportError } from "@/lib/monitoring/report";
import { leadPainterId, SITE_VISIT_BUCKET } from "./siteVisits";
import { MESSAGE_BUCKET, postErrorWords, threadFolder, type NotifyRecord } from "./messageModel";

/**
 * A site check-in note with "Send to painter" ticked is DELIVERED AS A
 * MESSAGE in the job's thread with its painter (Tom, 9 Oct 2026: one route for
 * messages to the painter). SERVER ONLY.
 *
 *   1. who: the job's lead painter (the lead assignment, else the contractor);
 *   2. the note's photos are copied from site-visit-photos into the thread's
 *      own folder of wo-messages — with the STAFF member's session, so both
 *      buckets' own policies say yes (staff read the one, may write the other);
 *   3. wo_message_post_from files it as an office message, once per note — the
 *      words are read from the note in SQL, never taken from here;
 *   4. the burst rule decides whether this telling goes now, and
 *      notifyPainterMessage tells them (the same text and email as any office
 *      message), recording the outcome on the message;
 *   5. the note's own sent_outcome / sent_detail carry that outcome in words,
 *      so the check-in card still says sent or why not.
 *
 * `staff` is the caller's session (RLS + storage policies); `service` writes
 * the note's outcome (authenticated has no write on wo_site_visit_notes).
 */
export type NoteDelivery =
  | { outcome: "sent"; detail: string }
  | { outcome: "skipped"; detail: string }
  | { outcome: "already"; detail: string }
  | { outcome: "not_applicable"; detail: string };

/** The note's sent_outcome is 'sent' | 'skipped' (20270248): held for sending hours or batched counts as on its way. */
export function noteOutcomeFor(rec: NotifyRecord | null): { outcome: "sent" | "skipped"; detail: string } {
  if (!rec) return { outcome: "sent", detail: "Covered by the text that just went — one per 10 minutes." };
  return rec.status === "sent" || rec.status === "queued"
    ? { outcome: "sent", detail: rec.detail }
    : { outcome: "skipped", detail: rec.detail };
}

const PHOTO_EXT = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);

/** "<photo id>.<ext>" under the thread's folder — the same name every time, so a retry overwrites nothing new. */
export function copiedPhotoPath(workOrderId: string, contractorId: string, photoId: string, sourcePath: string): string {
  const name = sourcePath.split("/").pop() ?? "";
  const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
  return `${threadFolder(workOrderId, contractorId)}sv-${photoId}.${PHOTO_EXT.has(ext) ? ext : "jpg"}`;
}
export async function deliverSiteVisitNote(staff: SupabaseClient, service: SupabaseClient, noteId: string): Promise<NoteDelivery> {
  const save = async (o: { outcome: "sent" | "skipped"; detail: string }): Promise<NoteDelivery> => {
    const { error } = await service.from("wo_site_visit_notes")
      .update({ sent_outcome: o.outcome, sent_detail: o.detail, sent_at: new Date().toISOString() })
      .eq("id", noteId);
    if (error) reportError(error, { where: "siteNoteMessage.record", extra: { noteId } });
    return o;
  };
  try {
    const { data: n, error: nErr } = await service.from("wo_site_visit_notes")
      .select("id, send_to_painter, sent_outcome, work_order_id, work_orders(contractor_id)")
      .eq("id", noteId).maybeSingle();
    if (nErr) throw nErr;
    const note = n as { id: string; send_to_painter: boolean; sent_outcome: string | null; work_order_id: string; work_orders: { contractor_id: string | null } | null } | null;
    if (!note?.work_orders || !note.send_to_painter) return { outcome: "not_applicable", detail: "That note isn't marked to send." };
    if (note.sent_outcome === "sent") return { outcome: "already", detail: "Already in the painter's messages." };

    const [{ data: assignments, error: aErr }, { data: photoRows, error: pErr }] = await Promise.all([
      service.from("wo_assignments").select("contractor_id, is_lead, status").eq("work_order_id", note.work_order_id),
      service.from("wo_site_visit_photos").select("id, storage_path").eq("note_id", note.id).order("created_at").limit(6),
    ]);
    if (aErr) throw aErr;
    if (pErr) throw pErr;
    const contractorId = leadPainterId((assignments ?? []) as { contractor_id: string; is_lead: boolean; status: string }[], note.work_orders.contractor_id);
    if (!contractorId) return save({ outcome: "skipped", detail: "There is no painter on this job yet." });

    // The photos, into the thread's folder. An object already there (a retry) is fine.
    const paths: string[] = [];
    for (const p of (photoRows ?? []) as { id: string; storage_path: string }[]) {
      const to = copiedPhotoPath(note.work_order_id, contractorId, p.id, p.storage_path);
      const { error } = await staff.storage.from(SITE_VISIT_BUCKET).copy(p.storage_path, to, { destinationBucket: MESSAGE_BUCKET });
      if (error && !/exists|duplicate/i.test(error.message)) {
        reportError(error, { where: "siteNoteMessage.copyPhoto", extra: { noteId, from: p.storage_path } });
        return save({ outcome: "skipped", detail: "A photo couldn't be copied into the painter's messages — try Send to painter again." });
      }
      paths.push(to);
    }

    const { data, error } = await staff.rpc("wo_message_post_from", {
      p_source: "site_checkin", p_source_id: note.id, p_contractor_id: contractorId, p_photo_paths: paths,
    });
    if (error) throw error;
    const r = (data ?? {}) as { ok?: boolean; error?: string; message_id?: string; notify?: boolean; already?: boolean };
    if (!r.ok || !r.message_id) {
      const detail = r.error === "not_staff" ? "Only the office can send a note." : r.error === "not_shared" ? "The note isn't marked to send." : postErrorWords(r.error);
      return save({ outcome: "skipped", detail });
    }
    if (r.already) return { outcome: "already", detail: "Already in the painter's messages." };
    const rec = r.notify ? await notifyPainterMessage(service, r.message_id) : null;
    return save(noteOutcomeFor(rec));
  } catch (e) {
    reportError(e, { where: "siteNoteMessage", extra: { noteId } });
    return save({ outcome: "skipped", detail: "Something went wrong sending it — the error monitor has it." });
  }
}
