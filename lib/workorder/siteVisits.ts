/**
 * Site check-ins (Tom, 9 Oct 2026; migration 20270248):
 *
 *   "the extra site visits don't send any alerts to the customer, they are
 *    logged just for Felipe."
 *   "site check ins shouldn't hold jobs back"
 *   "a site check in isn't documented as pass or fail, but progress notes can
 *    be made with the option to send to the painter, and also attach photos"
 *
 * A site check-in is a wo_site_visits row — NOT a quality check. Nothing that
 * gates a job (wo_qa_open_count, the qa routing, the stage gate), the painter's
 * fail text or the painter-status evaluator reads that table. It is closed by
 * "Mark visited", never by a result. Its notes are the office's own unless the
 * office sends one to the painter; the customer sees none of it.
 *
 * The bytes live in the PRIVATE `site-visit-photos` bucket at
 * <work_order_id>/<visit_id>/<file>; the `wo-photos` bucket would let the job's
 * painter and customer read them. Reads are short-lived signed URLs made with
 * the CALLER's session: staff sign every photo; a painter can sign only the
 * photos of notes sent to them (the bucket policy asks the photo row, which
 * RLS already narrows).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const SITE_VISIT_BUCKET = "site-visit-photos";
export const SITE_VISIT_NOTE_MAX = 2000;
const PHOTO_TTL_SECONDS = 3600;

export type SiteVisitPhoto = { id: string; url: string };
export type SiteVisitNote = {
  id: string; visitId: string; body: string; createdAt: string; author: string | null;
  sendToPainter: boolean; sentOutcome: "sent" | "skipped" | null; sentDetail: string; sentAt: string | null;
  photos: SiteVisitPhoto[];
};
export type SiteVisit = {
  id: string; date: string | null; time: string | null;
  visitedAt: string | null; visitedBy: string | null;
  notes: SiteVisitNote[];
  /** The last calendar-invite outcome (from the row's own invite_log). */
  invite: { outcome: string; method: string; at: string; toCount: number } | null;
};

/** Where a visit's photos go: under its own job and visit. */
export function siteVisitPhotoPrefix(workOrderId: string, visitId: string): string {
  return `${workOrderId}/${visitId}/`;
}

/**
 * The note's share state, in the office's words. A sent note is delivered as
 * a message in the job's thread with its painter (Tom, 9 Oct 2026: one route
 * to the painter — lib/workorder/siteNoteMessage.ts); `sentDetail` is what
 * telling them came to, from that message's notify outcome.
 */
export function noteShareLine(n: Pick<SiteVisitNote, "sendToPainter" | "sentOutcome" | "sentDetail" | "sentAt">, at: (iso: string) => string): string {
  if (!n.sendToPainter) return "Office only — the painter has not been sent this.";
  if (n.sentOutcome === "sent") return `In the painter's messages${n.sentAt ? ` since ${at(n.sentAt)}` : ""}. ${n.sentDetail || ""}`.trim();
  if (n.sentOutcome === "skipped") return `Not delivered: ${n.sentDetail || "no reason recorded"}`;
  return "Ticked to send — not in the painter's messages yet.";
}

/** Who hears about a note: the lead on an assigned job, else the job's contractor. */
export function leadPainterId(
  assignments: readonly { contractor_id: string; is_lead: boolean; status: string }[],
  jobContractorId: string | null,
): string | null {
  const lead = assignments.find((a) => a.is_lead && a.status !== "released");
  return lead?.contractor_id ?? jobContractorId ?? null;
}

type NoteRow = {
  id: string; visit_id: string; body: string; created_at: string; author: string | null;
  send_to_painter: boolean; sent_outcome: "sent" | "skipped" | null; sent_detail: string; sent_at: string | null;
};
type PhotoRow = { id: string; note_id: string; storage_path: string; created_at: string };

async function signed(db: SupabaseClient, rows: readonly PhotoRow[]): Promise<Map<string, SiteVisitPhoto[]>> {
  const byNote = new Map<string, SiteVisitPhoto[]>();
  if (rows.length === 0) return byNote;
  const { data, error } = await db.storage.from(SITE_VISIT_BUCKET).createSignedUrls(rows.map((r) => r.storage_path), PHOTO_TTL_SECONDS);
  if (error) throw new Error(`photo links: ${error.message}`);
  const urlByPath = new Map((data ?? []).map((s) => [s.path ?? "", s.signedUrl]));
  for (const r of rows) {
    const url = urlByPath.get(r.storage_path);
    if (!url) continue;
    byNote.set(r.note_id, [...(byNote.get(r.note_id) ?? []), { id: r.id, url }]);
  }
  return byNote;
}

function shapeNotes(notes: readonly NoteRow[], photos: Map<string, SiteVisitPhoto[]>, names: Map<string, string>): SiteVisitNote[] {
  return notes.map((n) => ({
    id: n.id, visitId: n.visit_id, body: n.body, createdAt: n.created_at,
    author: n.author ? names.get(n.author) ?? "the office" : null,
    sendToPainter: n.send_to_painter, sentOutcome: n.sent_outcome, sentDetail: n.sent_detail, sentAt: n.sent_at,
    photos: photos.get(n.id) ?? [],
  }));
}

/**
 * The PC job page's read — staff session. Every read is checked: a failure
 * is a line on the card, never an empty list.
 */
export async function loadSiteVisits(db: SupabaseClient, workOrderId: string): Promise<{ visits: SiteVisit[]; failure: string | null }> {
  const [visitsRes, notesRes, photosRes] = await Promise.all([
    db.from("wo_site_visits").select("id, scheduled_for, scheduled_time, visited_at, visited_by, invite_log, created_at")
      .eq("work_order_id", workOrderId).order("scheduled_for", { ascending: true, nullsFirst: false }).order("created_at"),
    db.from("wo_site_visit_notes").select("id, visit_id, body, created_at, author, send_to_painter, sent_outcome, sent_detail, sent_at")
      .eq("work_order_id", workOrderId).order("created_at"),
    db.from("wo_site_visit_photos").select("id, note_id, storage_path, created_at")
      .eq("work_order_id", workOrderId).order("created_at"),
  ]);
  const failures = [
    visitsRes.error && `the site check-ins (${visitsRes.error.message})`,
    notesRes.error && `their notes (${notesRes.error.message})`,
    photosRes.error && `their photos (${photosRes.error.message})`,
  ].filter((f): f is string => Boolean(f));

  const visitRows = (visitsRes.data ?? []) as {
    id: string; scheduled_for: string | null; scheduled_time: string | null; visited_at: string | null; visited_by: string | null;
    invite_log: { outcome?: string; method?: string; created_at?: string; to?: unknown[] }[] | null;
  }[];
  const noteRows = (notesRes.data ?? []) as NoteRow[];
  const people = [...new Set([...noteRows.map((n) => n.author), ...visitRows.map((v) => v.visited_by)].filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (people.length) {
    const { data, error } = await db.from("profiles").select("id, name").in("id", people);
    if (error) failures.push(`who wrote the notes (${error.message})`);
    for (const p of (data ?? []) as { id: string; name: string | null }[]) names.set(p.id, p.name || "the office");
  }
  let photos = new Map<string, SiteVisitPhoto[]>();
  try {
    photos = await signed(db, (photosRes.data ?? []) as PhotoRow[]);
  } catch (e) {
    failures.push(e instanceof Error ? e.message : "the photo links");
  }
  const notes = shapeNotes(noteRows, photos, names);

  const visits = visitRows.map((v) => {
    const log = Array.isArray(v.invite_log) ? v.invite_log : [];
    const last = log[log.length - 1];
    return {
      id: v.id, date: v.scheduled_for, time: v.scheduled_time?.slice(0, 5) ?? null,
      visitedAt: v.visited_at, visitedBy: v.visited_by ? names.get(v.visited_by) ?? "the office" : null,
      notes: notes.filter((n) => n.visitId === v.id),
      invite: last ? { outcome: last.outcome ?? "sent", method: last.method ?? "REQUEST", at: last.created_at ?? "", toCount: Array.isArray(last.to) ? last.to.length : 0 } : null,
    };
  });
  return { visits, failure: failures.length ? `Couldn't read ${failures.join(", ")}.` : null };
}
