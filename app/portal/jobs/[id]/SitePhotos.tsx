"use client";

import { useRef, useState, useTransition } from "react";
import { addJobNote } from "./tickActions";
import { isVideoFile, uploadFailureText, uploadingLabel, uploadWorkOrderMedia } from "@/lib/workorder/uploadMedia";

/**
 * Photos and notes from site, once the job is running.
 *
 * The before-photo gate on the tick list covers the record that has to exist;
 * this is everything else — progress shots, the finished side, and a note when
 * something needs saying that is not a variation. Notes land on the job's own
 * event log, so the office reads them beside the ticks that produced them.
 */
export default function SitePhotos({ workOrderId, areas }: { workOrderId: string; areas: string[] }) {
  const [area, setArea] = useState(areas[0] ?? "");
  const [kind, setKind] = useState<"progress" | "completion">("progress");
  const [note, setNote] = useState("");
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      await uploadWorkOrderMedia({ workOrderId, file, kind, area, onProgress: setProgress });
      setCount((c) => c + 1);
      setMessage(`${isVideoFile(file) ? "Video" : "Photo"} added${area ? ` to ${area}` : ""}.`);
    } catch (e) {
      setMessage(uploadFailureText(e, file));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12 }} data-testid="site-photos">
      <div className="tick-head"><b>Photos &amp; notes</b></div>

      {message && <p className="tick-msg" role="status" data-testid="photos-message">{message}</p>}

      {areas.length > 0 && (
        <div className="var-chips" style={{ marginTop: 10 }}>
          {areas.map((a) => (
            <button key={a} type="button" className={`var-chip ${area === a ? "on" : ""}`}
              onClick={() => setArea(a)} data-testid={`photo-area-${a}`}>{a}</button>
          ))}
        </div>
      )}

      <div className="var-chips">
        <button type="button" className={`var-chip ${kind === "progress" ? "on" : ""}`}
          onClick={() => setKind("progress")} data-testid="photo-kind-progress">Progress</button>
        <button type="button" className={`var-chip ${kind === "completion" ? "on" : ""}`}
          onClick={() => setKind("completion")} data-testid="photo-kind-completion">Finished</button>
      </div>

      {/* No `capture` — the OS offers camera OR photo library (Tom, 1 Sep). */}
      <input ref={fileInput} type="file" hidden
        accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />

      <button type="button" className="var-photo" disabled={busy}
        onClick={() => fileInput.current?.click()} data-testid="add-photo">
        {busy ? uploadingLabel(progress) : count > 0 ? `📷 ${count} added — add another photo or video` : "📷 Take a photo or video"}
      </button>

      <textarea className="var-note" rows={3} value={note} data-testid="job-note"
        placeholder="A note for the office — anything worth saying that isn't a variation."
        onChange={(e) => setNote(e.target.value)} />
      <button type="button" className="var-send" disabled={pending || note.trim().length < 3}
        data-testid="send-note"
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const r = await addJobNote({ workOrderId, note, area });
            if (r.ok) { setNote(""); setMessage("Note sent to the office."); }
            else setMessage(r.message);
          });
        }}>
        {pending ? "Sending…" : "Send the note"}
      </button>
    </div>
  );
}
