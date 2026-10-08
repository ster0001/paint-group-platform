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
export default function SitePhotos({ workOrderId, areas, photosAllowed = true }: {
  workOrderId: string;
  areas: string[];
  /**
   * Tom, 1 Oct (Saulius, Cootamundra): with Step 1 still waiting, seven photos
   * went in HERE and the scope stayed locked for a quarter of an hour. While
   * the before photos are missing this card has no photo button at all — the
   * only camera on the page is the green one in Step 1.
   */
  photosAllowed?: boolean;
}) {
  const [area, setArea] = useState(areas[0] ?? "");
  // Tom, 30 Sep: this card is for QUESTIONS only — before and after photos
  // have their own steps. Everything here files as a progress photo.
  const kind = "progress" as const;
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
      <div className="tick-head"><b>Got a question, or found something?</b></div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }} data-testid="site-photos-hint">
        Only add photos here if you have a question about an item on the job, or something the office should see.
        Before and after photos go in Step 1 and Step 3 above, not here.
      </p>

      {message && <p className="tick-msg" role="status" data-testid="photos-message">{message}</p>}

      {areas.length > 0 && (
        <div className="var-chips" style={{ marginTop: 10 }}>
          {areas.map((a) => (
            <button key={a} type="button" className={`var-chip ${area === a ? "on" : ""}`}
              onClick={() => setArea(a)} data-testid={`photo-area-${a}`}>{a}</button>
          ))}
        </div>
      )}

      {/* No `capture` — the OS offers camera OR photo library (Tom, 1 Sep). */}
      <input ref={fileInput} type="file" hidden
        accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />

      {photosAllowed ? (
        <button type="button" className="var-photo" disabled={busy}
          onClick={() => fileInput.current?.click()} data-testid="add-photo">
          {busy ? uploadingLabel(progress) : count > 0 ? `📷 ${count} sent — add another for your question` : "📷 Photo or video for your question"}
        </button>
      ) : (
        <p className="hint" style={{ padding: 0, marginTop: 8 }} data-testid="add-photo-after-step-1">
          Photos for a question can be added here once Step 1&rsquo;s before photos are in. Your before photos go in the green button above.
        </p>
      )}

      <textarea className="var-note" rows={3} value={note} data-testid="job-note"
        placeholder="Your question or note for the office — anything worth saying that isn't a variation."
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
