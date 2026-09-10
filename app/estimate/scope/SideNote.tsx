"use client";

import PhotoDrop from "./PhotoDrop";

import { useRef, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

/**
 * Tom, 8 Sep 2026: "a box at the bottom of each view in the exterior wizard…
 * a comments box which is optional for people to mention any extra prep…
 * also include a box to be able to attach a photo which is also optional."
 *
 * Both are OPTIONAL and neither prices anything: the note and the photos ride
 * to the estimator as an amber review line on that side, and the estimator
 * decides what the prep is worth. That is deliberate — a customer describing
 * flaking paint in prose must never move a number on its own.
 *
 * Photos take the same road as the wizard's own condition photos: a signed
 * upload straight into storage (the 4.5 MB request-body cap makes anything
 * else unreliable on a phone), then `/api/extract/photos` claims the rows for
 * this estimate as `defect_photo`, which is what the Plan & photos panel and
 * the estimator's sign-off both read.
 */
const MAX_PHOTOS = 6;

export default function SideNote({ estimateId, sideKey, sideLabel, note, photoCount, busy = false, onSave }: {
  estimateId: string;
  sideKey: string;
  sideLabel: string;
  note: string | null;
  photoCount: number;
  busy?: boolean;
  /** The page owns the write — this only collects the text and the uploads. */
  onSave: (note: string, photosAdded: number) => void;
}) {
  const [text, setText] = useState(note ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dirty = text.trim() !== (note ?? "").trim() || files.length > 0;

  /** Stage the chosen photos and claim them for this estimate. Returns how
   * many actually landed — a failed upload says so rather than vanishing. */
  async function uploadPhotos(): Promise<number> {
    if (files.length === 0) return 0;
    const supabase = createBrowserClient();
    const prep = await fetch("/api/extract/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: files.map((f) => ({ name: f.name, size: f.size })) }),
    });
    const prepJson = await prep.json().catch(() => ({}));
    if (!prep.ok) throw new Error(prepJson.error ?? "Those photos couldn't be uploaded.");
    const slots: Array<{ path: string; token: string }> = prepJson.uploads ?? [];
    const staged: Array<{ path: string; name: string }> = [];
    for (let i = 0; i < files.length && i < slots.length; i++) {
      const { error: upErr } = await supabase.storage
        .from("estimate-sources")
        .uploadToSignedUrl(slots[i].path, slots[i].token, files[i]);
      if (!upErr) staged.push({ path: slots[i].path, name: `${sideLabel} — ${files[i].name}`.slice(0, 200) });
    }
    if (staged.length === 0) throw new Error("Those photos couldn't be uploaded — try one at a time.");
    const res = await fetch("/api/extract/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploads: staged, estimateId }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? "Those photos couldn't be saved.");
    return Number(j.kept) || staged.length;
  }

  async function save() {
    if (uploading || busy || !dirty) return;
    setError(null);
    setUploading(true);
    try {
      const added = await uploadPhotos();
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      onSave(text.trim().slice(0, 600), added);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save — try again in a moment.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="sd-q sd-note" data-testid={`side-note-${sideKey}`}>
      <p className="sd-ql">Anything worth mentioning about this side? <span className="sd-opt">OPTIONAL</span></p>
      <p className="sd-help">
        Extra preparation is what moves a price most — flaking or bubbling paint, bare or rotten timber, render cracks,
        an old colour that will need an extra coat, a tricky bit to reach. Tell us here and add a photo if you have one,
        and your estimate comes back closer to the final number.
      </p>
      <textarea
        className="sd-notebox"
        rows={3}
        maxLength={600}
        value={text}
        placeholder="e.g. the boards under the window are flaking and there's a bit of rot by the downpipe"
        aria-label={`Notes about the ${sideLabel}`}
        data-testid={`side-note-text-${sideKey}`}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="sd-noterow">
        <PhotoDrop
          inputRef={inputRef}
          testId={`side-note-photo-${sideKey}`}
          multiple
          title="Take a photo of this side"
          hint="Optional, and the fastest way for us to price the preparation properly."
          ready={files.length > 0 ? `${files.length} photo${files.length > 1 ? "s" : ""} ready to send` : null}
          onFiles={(f) => { setFiles(f.slice(0, MAX_PHOTOS)); setError(null); }}
        />
        <button type="button" className="sd-notesave" disabled={!dirty || uploading || busy}
          data-testid={`side-note-save-${sideKey}`} onClick={() => void save()}>
          {uploading ? "Saving…" : "Save this note"}
        </button>
      </div>
      {photoCount > 0 && (
        <p className="sd-help" data-testid={`side-note-count-${sideKey}`}>
          {photoCount} photo{photoCount > 1 ? "s" : ""} on file for this side — your estimator reviews them.
        </p>
      )}
      {note && text.trim() === note.trim() && files.length === 0 && (
        <p className="sd-help">Saved — your estimator reads this before pricing the prep here.</p>
      )}
      {error && <p className="sd-noteerr" role="alert">{error}</p>}
    </div>
  );
}
