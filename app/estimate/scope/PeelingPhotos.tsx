"use client";

import { useRef, useState } from "react";
import PhotoDrop from "./PhotoDrop";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

/**
 * Tom, 15 Sep (late, item 7): a photo of the peeling, attached from the
 * condition question. Same road as the side-note photos — a signed upload
 * straight into storage, then `/api/extract/photos` claims the rows as this
 * estimate's defect photos, labelled so the estimator's pack says what they
 * show. Nothing here prices; the count rides `loop_cond.peelingPhotos`.
 */
export default function PeelingPhotos({ estimateId, count, busy, onUploaded }: {
  estimateId: string;
  /** Photos already attached, for the "2 photos attached" line. */
  count: number;
  busy: boolean;
  onUploaded: (added: number) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function upload(files: File[]) {
    if (files.length === 0 || uploading) return;
    setError(null);
    setUploading(true);
    try {
      const supabase = createBrowserClient();
      const prep = await fetch("/api/extract/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: files.map((f) => ({ name: f.name, size: f.size })) }),
      });
      const prepJson = await prep.json().catch(() => ({}));
      if (!prep.ok) throw new Error(prepJson.error ?? "Those photos couldn't be uploaded.");
      const slots: Array<{ path: string; token: string }> = prepJson.uploads ?? [];
      const staged: Array<{ path: string; name: string; label: string }> = [];
      for (let i = 0; i < files.length && i < slots.length; i++) {
        const { error: upErr } = await supabase.storage.from("estimate-sources").uploadToSignedUrl(slots[i].path, slots[i].token, files[i]);
        if (!upErr) staged.push({ path: slots[i].path, name: `Peeling — ${files[i].name}`.slice(0, 200), label: "Peeling & flaking" });
      }
      if (staged.length === 0) throw new Error("Those photos couldn't be uploaded — try one at a time.");
      const res = await fetch("/api/extract/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploads: staged, estimateId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Those photos couldn't be saved.");
      onUploaded(Number(j.kept) || staged.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save — try again in a moment.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="sd-peelphotos" data-testid="peeling-photos">
      <PhotoDrop
        inputRef={inputRef}
        testId="peeling-photo"
        multiple
        title={uploading ? "Uploading…" : "Add a photo of the peeling"}
        hint="Optional — a photo lets us price the preparation instead of guessing it."
        ready={count > 0 && !uploading ? `${count} photo${count === 1 ? "" : "s"} attached — add more?` : null}
        disabled={busy || uploading}
        onFiles={(files) => { void upload(files); }}
      />
      {error && <p className="sd-help" style={{ color: "var(--clay, #b3574a)" }} data-testid="peeling-photo-error">{error}</p>}
    </div>
  );
}
