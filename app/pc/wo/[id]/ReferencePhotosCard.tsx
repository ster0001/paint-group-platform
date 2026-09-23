"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteReferencePhoto } from "../../actions";
import { photoWhen } from "@/lib/workorder/photos";
import type { WOPhoto } from "@/lib/workorder/photos";

/**
 * Photos the office attaches for the painter (Tom, 23 Sep 2026):
 * "we need to add photos to all the jobs coming in from paint scout."
 *
 * A handover job's estimate carries no photos, and the job sheet's own photos
 * are frozen into wo_snapshot at acceptance — so before this there was nothing
 * to show a painter on those jobs at all. What goes here is an INSTRUCTION
 * about the work: the elevation the scaffold goes on, where the gear lives, the
 * colour to match. It lands on their job sheet under "From the office", above
 * the scope.
 *
 * It is NOT the painter's record — their before/progress/completion shots are
 * theirs, live under Site photos, and Remove here cannot touch them (the RPC
 * refuses anything that is not a reference photo).
 */
export default function ReferencePhotosCard({
  workOrderId, areas, photos,
}: {
  workOrderId: string;
  /** Area headings off the job sheet, so a photo can name where it belongs. */
  areas: string[];
  photos: WOPhoto[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [area, setArea] = useState("");
  const [caption, setCaption] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      // Same two-stage path as every other photo: sign, PUT the bytes straight
      // to storage (a 4 MB serverless body will not carry a phone photo), then
      // ingest — which sniffs the real bytes before any row is written.
      const signRes = await fetch("/api/wo/photos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId, size: file.size }),
      });
      const sign = await signRes.json();
      if (!signRes.ok) throw new Error(sign.error ?? "We couldn't start that upload.");

      const put = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/wo-photos/${sign.path}?token=${sign.token}`,
        { method: "PUT", body: file },
      );
      if (!put.ok) throw new Error("The upload didn't finish — try again.");

      const ingest = await fetch("/api/wo/photos", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workOrderId, path: sign.path, kind: "reference",
          area, caption: caption.trim(),
        }),
      });
      const done = await ingest.json();
      if (!ingest.ok) throw new Error(done.error ?? "We couldn't file that photo.");

      setMessage("Added — it's on the painter's job sheet.");
      setCaption("");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "That didn't work — try again.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function remove(photoId: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await deleteReferencePhoto({ photoId });
      setMessage(res.message ?? null);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="card" style={{ marginTop: 8 }} data-testid="reference-photos-card">
      <h3>Photos for the painter <em>{photos.length || ""}</em></h3>
      <p className="note">
        Anything the painter needs to see: the elevation the scaffold goes on, where
        the gear lives, the colour to match. These land on their job sheet under
        <b> From the office</b>, above the scope — and on a handover job they&rsquo;re
        usually the only picture of the job there is. Their own before and after
        shots are separate and stay theirs.
      </p>

      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={area} onChange={(e) => setArea(e.target.value)}
          data-testid="reference-photo-area" aria-label="Which area"
        >
          <option value="">Whole job</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          value={caption} onChange={(e) => setCaption(e.target.value)}
          placeholder="What the painter should notice"
          data-testid="reference-photo-caption" aria-label="Caption"
          style={{ flex: "1 1 240px" }}
        />
        <input
          ref={fileInput} type="file" accept="image/*"
          data-testid="reference-photo-file" aria-label="Choose a photo"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
        />
        {busy && <span className="note">Uploading…</span>}
        {message && <span className="note" data-testid="reference-photo-msg">{message}</span>}
      </div>

      {photos.length > 0 && (
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          {photos.map((p) => (
            <figure key={p.id} data-testid="reference-photo-row" style={{ margin: 0, width: 150 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url} alt={p.caption || p.area || "Job photo"}
                style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 10 }}
              />
              <figcaption className="note" style={{ marginTop: 4 }}>
                {p.area ? <b>{p.area}</b> : <b>Whole job</b>}
                {p.caption ? ` · ${p.caption}` : ""}
                <br />
                <span style={{ opacity: .7 }}>{photoWhen(p)}</span>
                <button
                  type="button" className="btn" style={{ marginTop: 4 }}
                  onClick={() => remove(p.id)} disabled={pending}
                  data-testid={`reference-photo-remove-${p.id}`}
                >
                  Remove
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
