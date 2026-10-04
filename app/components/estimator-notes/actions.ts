"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import { ESTIMATOR_NOTES_BUCKET } from "@/lib/estimate/notesBucket";

/**
 * Estimator notes (Tom, 4 Oct 2026) — internal, dated notes on an estimate:
 * typed, or a voice memo. Read by the builder and the project's PC command
 * page; never by a contractor or customer surface. Staff only here AND at the
 * database (RLS, private bucket), so a session that is not staff gets a
 * refusal, not an empty list.
 */

export type EstimateNote = {
  id: string;
  kind: "text" | "voice";
  body: string;
  /** Voice only — a short-lived signed URL for the player. */
  audioUrl: string | null;
  durationSeconds: number | null;
  author: string;
  createdAt: string;
};

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const uuid = z.string().uuid();

async function staffSession() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, ok: false as const };
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (error) reportError(error, { where: "estimatorNotes.staffSession" });
  return { supabase, user, ok: !error && profile?.role === "staff" };
}

const NOT_STAFF = "You don't have permission to do that.";

type Row = {
  id: string; kind: "text" | "voice"; body: string; audio_path: string | null;
  duration_seconds: number | null; author: string | null; created_at: string;
};

export async function listEstimateNotesAction(raw: unknown): Promise<Result<EstimateNote[]>> {
  const parsed = z.object({ estimateId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That estimate id isn't valid." };
  const { supabase, ok } = await staffSession();
  if (!ok) return { ok: false, message: NOT_STAFF };

  // `error` is read, never dropped: an empty list here must mean "no notes",
  // not "the read was refused" (CLAUDE.md, the Invoicing lesson).
  const { data, error } = await supabase
    .from("estimate_notes")
    .select("id, kind, body, audio_path, duration_seconds, author, created_at")
    .eq("estimate_id", parsed.data.estimateId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    reportError(error, { where: "estimatorNotes.list", extra: { estimateId: parsed.data.estimateId } });
    return { ok: false, message: `Couldn't load the notes — ${error.message}` };
  }
  const rows = (data ?? []) as Row[];

  const authorIds = [...new Set(rows.map((r) => r.author).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: people, error: pErr } = await supabase.from("profiles").select("id, name").in("id", authorIds);
    // Names are decoration; a refused read leaves them blank and is reported, never hidden.
    if (pErr) reportError(pErr, { where: "estimatorNotes.authors" });
    for (const p of (people ?? []) as { id: string; name: string | null }[]) if (p.name) names.set(p.id, p.name);
  }

  // One signed URL per voice note, an hour each — the player streams straight
  // from storage; the audio never passes through the app server.
  const notes: EstimateNote[] = [];
  for (const r of rows) {
    let audioUrl: string | null = null;
    if (r.kind === "voice" && r.audio_path) {
      const { data: signed, error: sErr } = await supabase.storage.from(ESTIMATOR_NOTES_BUCKET).createSignedUrl(r.audio_path, 3600);
      if (sErr) reportError(sErr, { where: "estimatorNotes.sign", extra: { noteId: r.id } });
      audioUrl = signed?.signedUrl ?? null;
    }
    notes.push({
      id: r.id, kind: r.kind, body: r.body, audioUrl, durationSeconds: r.duration_seconds,
      author: r.author ? names.get(r.author) ?? "" : "", createdAt: r.created_at,
    });
  }
  return { ok: true, value: notes };
}

function touched(estimateId: string) {
  revalidatePath(`/quote`);
  revalidatePath(`/pc/wo`, "layout");
  void estimateId;
}

export async function addTextNoteAction(raw: unknown): Promise<Result<string>> {
  const parsed = z.object({
    estimateId: uuid,
    body: z.string().transform((t) => t.trim()).pipe(z.string().min(1, "Write the note first.").max(4000)),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That note isn't valid." };
  const { supabase, user, ok } = await staffSession();
  if (!ok) return { ok: false, message: NOT_STAFF };
  const { data, error } = await supabase.from("estimate_notes")
    .insert({ estimate_id: parsed.data.estimateId, kind: "text", body: parsed.data.body, author: user?.id ?? null })
    .select("id").single();
  if (error) return { ok: false, message: error.message };
  touched(parsed.data.estimateId);
  return { ok: true, value: (data as { id: string }).id };
}

/**
 * The recording is uploaded by the browser straight into the private bucket
 * (staff-only insert policy; the bucket itself enforces audio MIME + 25 MB).
 * This records the row — and refuses a path outside this estimate's folder,
 * so a note can never point at another estimate's recording.
 */
export async function addVoiceNoteAction(raw: unknown): Promise<Result<string>> {
  const parsed = z.object({
    estimateId: uuid,
    path: z.string().regex(/^[0-9a-f-]{36}\/\d{10,16}\.(webm|mp4|m4a|ogg|mp3|wav)$/, "unexpected recording path"),
    mime: z.string().regex(/^audio\/[a-z0-9.+-]+$/i).max(60),
    durationSeconds: z.number().int().min(0).max(3600).nullish(),
    body: z.string().trim().max(4000).default(""),
  }).refine((v) => v.path.startsWith(`${v.estimateId}/`), { message: "recording belongs to another estimate", path: ["path"] })
    .safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That recording isn't valid." };
  const { supabase, user, ok } = await staffSession();
  if (!ok) return { ok: false, message: NOT_STAFF };
  const v = parsed.data;
  const { data, error } = await supabase.from("estimate_notes")
    .insert({
      estimate_id: v.estimateId, kind: "voice", body: v.body, audio_path: v.path, audio_mime: v.mime,
      duration_seconds: v.durationSeconds ?? null, author: user?.id ?? null,
    })
    .select("id").single();
  if (error) return { ok: false, message: error.message };
  touched(v.estimateId);
  return { ok: true, value: (data as { id: string }).id };
}

export async function deleteNoteAction(raw: unknown): Promise<Result<null>> {
  const parsed = z.object({ noteId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That note id isn't valid." };
  const { supabase, ok } = await staffSession();
  if (!ok) return { ok: false, message: NOT_STAFF };
  const { data: row, error: readErr } = await supabase.from("estimate_notes").select("estimate_id, audio_path").eq("id", parsed.data.noteId).maybeSingle();
  if (readErr) return { ok: false, message: readErr.message };
  const { error } = await supabase.from("estimate_notes").delete().eq("id", parsed.data.noteId);
  if (error) return { ok: false, message: error.message };
  const r = row as { estimate_id: string; audio_path: string | null } | null;
  if (r?.audio_path) {
    // Best effort: an orphaned file in a private bucket is waste, not a leak.
    const { error: rmErr } = await supabase.storage.from(ESTIMATOR_NOTES_BUCKET).remove([r.audio_path]);
    if (rmErr) reportError(rmErr, { where: "estimatorNotes.removeAudio", extra: { noteId: parsed.data.noteId } });
  }
  if (r) touched(r.estimate_id);
  return { ok: true, value: null };
}
