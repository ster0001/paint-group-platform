"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markCallbackFixedAction } from "@/app/portal/callbackActions";
import { uploadFailureText, uploadWorkOrderMedia } from "@/lib/workorder/uploadMedia";
import { dmy, type Callback } from "@/lib/callbacks/model";
import PhotoGrid from "@/app/components/wo/PhotoGrid";
import type { WOPhoto } from "@/lib/workorder/photos";

/**
 * A call back on the painter's phone (brief §7): what is wrong, the return
 * visit, the photos, and "Mark as fixed" with a photo (⚑22). The office
 * confirms and closes it; until then it reads "waiting for the office".
 * Short sentences — English is not every painter's first language.
 */
export default function CallbackCard({ callback, photos, jobTitle, mine }: {
  callback: Callback; photos: WOPhoto[]; jobTitle: string;
  /** True when this painter did the job or is the one booked to fix it. */
  mine: boolean;
}) {
  const router = useRouter();
  const c = callback;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    setUploading(true); setMessage(null);
    try {
      const { id } = await uploadWorkOrderMedia({ workOrderId: c.workOrderId, file, kind: "callback", area: "Call back", caption: "Fixed" });
      setPhotoIds((ids) => [...ids, id]);
    } catch (e) { setMessage(uploadFailureText(e, file)); }
    finally { setUploading(false); }
  }

  function markFixed() {
    setMessage(null);
    start(async () => {
      const r = await markCallbackFixedAction({ callbackId: c.id, workOrderId: c.workOrderId, note, photoIds });
      setMessage(r.message);
      if (r.ok) { setOpen(false); router.refresh(); }
    });
  }

  return (
    <div className="card amberish" data-testid={`callback-${c.id}`} data-status={c.status}>
      <span className="chip cly">Call back</span>
      <div style={{ marginTop: 8, fontWeight: 600, fontSize: "14.5px" }}>{jobTitle}</div>
      <p style={{ marginTop: 6, fontSize: "14px" }} data-testid={`callback-what-${c.id}`}>{c.description || "The office will tell you what is wrong."}</p>
      <p className="hint" data-testid={`callback-visit-${c.id}`}>
        {c.visit ? `Return visit: ${dmy(c.visit.start)}${c.visit.end !== c.visit.start ? ` to ${dmy(c.visit.end)}` : ""}.` : "The office will book the return visit."}
        {c.status === "fixed" ? " Marked fixed — waiting for the office to confirm." : ""}
      </p>
      {photos.length > 0 && <div style={{ marginTop: 8 }}><PhotoGrid photos={photos} tight showKind={false} empty="" /></div>}
      {message && <p className="tick-msg" role="status" data-testid={`callback-message-${c.id}`}>{message}</p>}
      {mine && (c.status === "open" || c.status === "booked") && (
        open ? (
          <div style={{ marginTop: 10 }} data-testid={`callback-fix-form-${c.id}`}>
            <input ref={fileInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/heic" data-testid={`callback-fix-file-${c.id}`}
              onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; void (async () => { for (const f of files) await upload(f); })(); }} />
            <button type="button" className="var-photo" disabled={uploading} onClick={() => fileInput.current?.click()} data-testid={`callback-fix-photo-${c.id}`}>
              {uploading ? "Uploading…" : photoIds.length === 0 ? "📷 Add a photo of the fix" : `📷 ${photoIds.length} photo${photoIds.length === 1 ? "" : "s"} added — add another`}
            </button>
            <textarea className="var-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you did (optional)" style={{ marginTop: 8 }} />
            <button type="button" className="btn cy" disabled={pending || photoIds.length === 0} onClick={markFixed} data-testid={`callback-fix-save-${c.id}`}>
              {pending ? "Saving…" : "Mark as fixed"}
            </button>
            <button type="button" className="btn gh" onClick={() => setOpen(false)}>Not yet</button>
          </div>
        ) : (
          <button type="button" className="btn cy" style={{ marginTop: 10 }} onClick={() => setOpen(true)} data-testid={`callback-fix-${c.id}`}>
            Fixed — add a photo
          </button>
        )
      )}
    </div>
  );
}
