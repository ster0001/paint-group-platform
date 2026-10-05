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
  // Tom, 4 Oct: "if the browser blocks the microphone it pops up with a popup
  // allowing to unblock". A site cannot re-ask once the browser has said no —
  // only the person can flip it in the address bar — so the popup tells them
  // exactly where for THEIR browser, and Try again re-asks the moment they have.
  const [micHelp, setMicHelp] = useState<null | { state: "denied" | "prompt" | "unknown" }>(null);
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
      if (e instanceof Error && (e.name === "NotAllowedError" || e.name === "SecurityError" || e.name === "NotFoundError")) {
        let state: "denied" | "prompt" | "unknown" = "unknown";
        try {
          const q = await navigator.permissions?.query?.({ name: "microphone" as PermissionName });
          if (q?.state === "denied" || q?.state === "prompt") state = q.state;
        } catch { /* Safari has no microphone permission query — the steps below still apply */ }
        setMicHelp({ state: e.name === "NotFoundError" ? "unknown" : state });
        setErr("");
        return;
      }
      setErr(`Couldn't start recording — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Which browser's unblock steps to show. UA sniffing is fine here: it only picks the wording. */
  function browserSteps(): { name: string; steps: string[] } {
    const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
    const iOS = /iPhone|iPad|iPod/.test(ua);
    if (/Firefox\//.test(ua)) return { name: "Firefox", steps: [
      "Click the microphone (or padlock) icon at the left of the address bar.",
      "Next to Microphone, click the ✕ to clear \"Blocked\".",
      "Press Try again below and choose Allow when Firefox asks.",
    ] };
    if (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg/.test(ua)) return iOS
      ? { name: "Safari on iPhone / iPad", steps: [
          "Tap the \"AA\" (or the page icon) at the left of the address bar.",
          "Tap Website Settings, then Microphone, then Allow.",
          "Come back here and press Try again.",
        ] }
      : { name: "Safari", steps: [
          "In the Safari menu, choose \"Settings for This Website…\" (or right-click the address bar).",
          "Set Microphone to Allow.",
          "Press Try again below.",
        ] };
    if (/Edg\//.test(ua)) return { name: "Microsoft Edge", steps: [
      "Click the padlock at the left of the address bar.",
      "Switch Microphone to Allow (or open Permissions for this site and allow it).",
      "Press Try again below — no reload needed.",
    ] };
    return { name: /CriOS|Android/.test(ua) ? "Chrome on your phone" : "Chrome", steps: [
      "Click the icon at the left of the address bar (a padlock or two small sliders).",
      "Turn Microphone on — or open Site settings and set Microphone to Allow.",
      "Press Try again below — no reload needed.",
    ] };
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

              {micHelp && (() => {
                const b = browserSteps();
                return (
                  <div className="enotes-modal-scrim" role="dialog" aria-modal="true" aria-labelledby="enotes-mic-title" data-testid="mic-help" onClick={() => setMicHelp(null)}>
                    <div className="enotes-modal" onClick={(e) => e.stopPropagation()}>
                      <h3 id="enotes-mic-title">{micHelp.state === "prompt" ? "The microphone wasn't allowed" : "The microphone is blocked for this site"}</h3>
                      <p>
                        {micHelp.state === "prompt"
                          ? `${b.name} asked and the answer was no (or the prompt was closed). Press Try again and choose Allow.`
                          : `${b.name} remembers a \"no\" for this site, so it won't ask again on its own. Unblock it here:`}
                      </p>
                      {micHelp.state !== "prompt" && (
                        <ol>{b.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
                      )}
                      <p className="enotes-hint">Recording needs a secure address (https, or localhost) and a microphone the computer can see.</p>
                      <div className="enotes-actions">
                        <button type="button" className="enotes-btn primary" data-testid="mic-help-retry" onClick={() => { setMicHelp(null); void startRecording(); }}>Try again</button>
                        <button type="button" className="enotes-btn" data-testid="mic-help-close" onClick={() => setMicHelp(null)}>Not now</button>
                      </div>
                    </div>
                  </div>
                );
              })()}

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
