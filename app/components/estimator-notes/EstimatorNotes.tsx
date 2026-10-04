"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addTextNoteAction, addVoiceNoteAction, deleteNoteAction, listEstimateNotesAction, type EstimateNote,
} from "./actions";
import { ESTIMATOR_NOTES_BUCKET } from "@/lib/estimate/notesBucket";
import "./estimator-notes.css";

/**
 * Estimator notes (Tom, 4 Oct 2026): typed notes and voice memos on an
 * estimate, internal only. ONE component for both places it appears — the top
 * of the estimate builder and the project's PC command page — with a
 * `surface` prop for the chrome, never two copies.
 *
 * Nothing rendered here reaches a contractor: the list is loaded by a
 * staff-only action after mount, so the HTML of any page that happens to
 * embed this carries no note text server-side either.
 */
export default function EstimatorNotes({ estimateId, surface, who = "the office" }: {
  /** Null while the builder has an unsaved, brand-new estimate. */
  estimateId: string | null;
  surface: "builder" | "console";
  /** Who else reads these — named in the hint so the estimator knows where they land. */
  who?: string;
}) {
  const [notes, setNotes] = useState<EstimateNote[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(surface === "console");

  const load = useCallback(async () => {
    if (!estimateId) { setNotes([]); return; }
    const r = await listEstimateNotesAction({ estimateId });
    if (r.ok) { setNotes(r.value); setLoadErr(""); }
    else { setNotes([]); setLoadErr(r.message); }
  }, [estimateId]);

  // Deferred a tick so no state is written synchronously inside the effect.
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  async function saveText() {
    if (!estimateId) return;
    setBusy(true); setErr("");
    const r = await addTextNoteAction({ estimateId, body: text });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    setText("");
    await load();
  }

  async function remove(noteId: string) {
    setBusy(true); setErr("");
    const r = await deleteNoteAction({ noteId });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    await load();
  }

  // ---- voice ---------------------------------------------------------------
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  // Elapsed time is counted by the half-second tick, not read from a clock —
  // nothing impure runs in render, and the duration saved is what was shown.
  const ticks = useRef(0);
  const timer = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const canRecord = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  async function startRecording() {
    if (!estimateId) return;
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Chrome/Firefox record webm; Safari records mp4. Take what the browser has.
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void uploadRecording(new Blob(chunks.current, { type: rec.mimeType || mime || "audio/webm" }));
      };
      recRef.current = rec;
      ticks.current = 0;
      setElapsed(0);
      timer.current = window.setInterval(() => { ticks.current += 1; setElapsed(Math.round(ticks.current / 2)); }, 500);
      rec.start(1000);
      setRecording(true);
    } catch (e) {
      setErr(e instanceof Error && e.name === "NotAllowedError"
        ? "The browser blocked the microphone. Allow it for this site and try again."
        : `Couldn't start recording — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function stopRecording() {
    if (timer.current) { window.clearInterval(timer.current); timer.current = null; }
    setRecording(false);
    recRef.current?.stop();
    recRef.current = null;
  }

  async function uploadRecording(blob: Blob) {
    if (!estimateId) return;
    const seconds = Math.max(0, Math.round(ticks.current / 2));
    if (blob.size === 0) { setErr("Nothing was recorded."); return; }
    setBusy(true); setErr("");
    try {
      const baseMime = (blob.type || "audio/webm").split(";")[0].trim().toLowerCase();
      const ext = baseMime === "audio/mp4" ? "mp4" : baseMime === "audio/ogg" ? "ogg" : baseMime === "audio/mpeg" ? "mp3" : baseMime === "audio/wav" ? "wav" : "webm";
      const path = `${estimateId}/${new Date().getTime()}.${ext}`;
      const supabase = createClient();
      const { error } = await supabase.storage.from(ESTIMATOR_NOTES_BUCKET).upload(path, blob, { contentType: baseMime, upsert: false });
      if (error) throw error;
      const r = await addVoiceNoteAction({ estimateId, path, mime: baseMime, durationSeconds: seconds, body: text.trim() });
      if (!r.ok) throw new Error(r.message);
      setText("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
    setBusy(false);
  }

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); recRef.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const count = notes?.length ?? 0;
  const mmss = (s: number | null) => s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });

  return (
    <section className={`enotes enotes-${surface}`} data-testid="estimator-notes" data-count={count}>
      <button type="button" className="enotes-head" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="estimator-notes-toggle">
        <span className="enotes-title">
          Estimator notes
          <span className="enotes-sub"> · internal · {who} {surface === "builder" ? "sees these on the project page" : "and the estimator"} · never the painter or the customer</span>
        </span>
        <span className="enotes-badge" data-testid="estimator-notes-count">{notes == null ? "…" : count === 0 ? "none yet" : `${count} note${count === 1 ? "" : "s"}`}</span>
        <span className="enotes-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="enotes-body">
          {!estimateId ? (
            <p className="enotes-hint">Save the estimate once and the notes live here — typed or spoken.</p>
          ) : (
            <>
              <div className="enotes-compose">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={text.split("\n").length > 2 ? Math.min(6, text.split("\n").length + 1) : 2}
                  placeholder={recording ? "Recording… type a caption for the memo if you like" : "Type a note — what the customer said, access, budget, what to watch for on site…"}
                  disabled={busy}
                  maxLength={4000}
                  data-testid="estimator-note-input"
                  aria-label="New estimator note"
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void saveText(); }}
                />
                <div className="enotes-actions">
                  <button type="button" className="enotes-btn primary" disabled={busy || recording || !text.trim()} onClick={saveText} data-testid="estimator-note-save">
                    {busy && !recording ? "Saving…" : "Add note"}
                  </button>
                  {canRecord && (
                    recording ? (
                      <button type="button" className="enotes-btn rec on" onClick={stopRecording} data-testid="estimator-note-stop">
                        ■ Stop &amp; save <span className="enotes-time">{mmss(elapsed)}</span>
                      </button>
                    ) : (
                      <button type="button" className="enotes-btn rec" disabled={busy} onClick={startRecording} data-testid="estimator-note-record" title="Record a voice memo">
                        ● Record voice note
                      </button>
                    )
                  )}
                  <span className="enotes-hint">⌘↵ adds the typed note{canRecord ? "; a recording saves when you press Stop" : ""}.</span>
                </div>
                {err && <div className="enotes-err" data-testid="estimator-note-error">{err}</div>}
              </div>

              {loadErr && <div className="enotes-err">{loadErr}</div>}
              {notes && notes.length === 0 && !loadErr && (
                <p className="enotes-hint" data-testid="estimator-notes-empty">No notes on this job yet.</p>
              )}
              <ul className="enotes-list">
                {(notes ?? []).map((n) => (
                  <li key={n.id} className={`enotes-item ${n.kind}`} data-testid="estimator-note" data-kind={n.kind}>
                    <div className="enotes-meta">
                      <span className="enotes-kind">{n.kind === "voice" ? "🎙 Voice" : "✎ Note"}</span>
                      <span>{when(n.createdAt)}{n.author ? ` · ${n.author}` : ""}{n.kind === "voice" && n.durationSeconds != null ? ` · ${mmss(n.durationSeconds)}` : ""}</span>
                      <button type="button" className="enotes-del" disabled={busy} onClick={() => remove(n.id)} aria-label="Delete this note" data-testid="estimator-note-delete">Delete</button>
                    </div>
                    {n.kind === "voice" && (
                      n.audioUrl
                        ? <audio controls preload="none" src={n.audioUrl} className="enotes-audio" data-testid="estimator-note-audio" />
                        : <span className="enotes-hint">Recording unavailable — the link couldn&rsquo;t be signed.</span>
                    )}
                    {n.body && <p className="enotes-text">{n.body}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
