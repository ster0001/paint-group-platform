"use client";

import { useRef, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { ROOM_CONDITION_LABEL, ROOM_CONDITIONS, tagsFor, type RoomCondition } from "@/lib/wizard/spots";
import type { RoomSpot } from "@/lib/wizard/scope-editor";

/**
 * "Point out a spot" — plan §4.3, prototype screen 7.
 *
 * Condition used to be ONE answer for the whole house, and "needs repair"
 * opened a free-text box the engine could not price (plan §2.3). This asks the
 * two things a customer can actually judge standing in the room: how it
 * compares with the rest, and where the damage is.
 *
 * A spot is a tag and (optionally) a photo. The server decides what it costs —
 * ⚑6 auto-prices a crack and a nail hole and sends everything else to a
 * person. Nothing here posts hours or money; the tag is the whole message.
 *
 * The photo path is SideNote's, deliberately: stage an upload URL, put the
 * file in the bucket, claim it for this estimate, then post the tag with the
 * source id. A failed upload still records the spot — losing the customer's
 * answer because their photo failed would be the worst of both.
 */
export default function RoomSpots({
  estimateId, areaId, roomName, side, spots, condition, busy, onAdd, onRemove, onCondition,
}: {
  estimateId: string;
  areaId: number;
  roomName: string;
  side: "interior" | "exterior";
  spots: RoomSpot[];
  condition: RoomCondition;
  busy?: boolean;
  onAdd: (tag: string, sourceId: string | null) => void;
  onRemove: (surfaceId: number) => void;
  onCondition: (c: RoomCondition) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);

  /** Stage one photo and claim it for this estimate. Null when there is none. */
  async function uploadPhoto(): Promise<string | null> {
    if (!file) return null;
    const supabase = createBrowserClient();
    const prep = await fetch("/api/extract/upload-url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ name: file.name, size: file.size }] }),
    });
    const prepJson = await prep.json().catch(() => ({}));
    if (!prep.ok) throw new Error(prepJson.error ?? "That photo couldn't be uploaded.");
    const slot = (prepJson.uploads ?? [])[0] as { path: string; token: string } | undefined;
    if (!slot) throw new Error("That photo couldn't be uploaded.");
    const { error: upErr } = await supabase.storage
      .from("estimate-sources").uploadToSignedUrl(slot.path, slot.token, file);
    if (upErr) throw new Error("That photo couldn't be uploaded — try a smaller one.");
    const res = await fetch("/api/extract/photos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      // estimateId CLAIMS the row. Without it the photo is written with
      // estimate_id null and nothing ever sets it — the orphaned-photo bug
      // that left 92 rows unreachable (R5, estimate-documents).
      body: JSON.stringify({
        uploads: [{ path: slot.path, name: `${roomName} — ${file.name}`.slice(0, 200) }],
        estimateId,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? "That photo couldn't be saved.");
    const ids: string[] = Array.isArray(j.sourceIds) ? j.sourceIds : [];
    return ids[0] ?? null;
  }

  async function addSpot(tag: string) {
    if (busy || pending) return;
    setPending(tag); setError(null);
    let sourceId: string | null = null;
    try {
      sourceId = await uploadPhoto();
    } catch (e) {
      // The spot is still worth recording — the customer told us something
      // true about their house and the photo is the evidence, not the point.
      setError(e instanceof Error ? `${e.message} We've noted the spot anyway.` : "The photo didn't upload — we've noted the spot anyway.");
    }
    onAdd(tag, sourceId);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    setPending(null);
    setOpen(false);
  }

  return (
    <div className="sc-spots" data-testid={`room-spots-${areaId}`}>
      <p className="il-ql">
        How&rsquo;s this room compared with the rest?
      </p>
      <div className="sc-chips">
        {ROOM_CONDITIONS.map((c) => (
          <button
            key={c} type="button"
            className={`sd-chip il-chip ${condition === c ? "on" : ""}`}
            aria-pressed={condition === c}
            data-testid={`room-cond-${areaId}-${c}`}
            onClick={() => onCondition(c)}
          >{ROOM_CONDITION_LABEL[c]}</button>
        ))}
      </div>

      {spots.length > 0 && (
        <ul className="sc-spotlist" data-testid={`spot-list-${areaId}`}>
          {spots.map((s) => (
            <li key={s.surfaceId} data-testid={`spot-${s.surfaceId}`}>
              <span className="sc-spot-name">{s.label}</span>
              <span className="sc-spot-state">
                {s.prepHr > 0 ? "repair priced" : "we'll price this one"}
                {!s.fromCustomer && " · from your photo"}
              </span>
              {s.fromCustomer && (
                <button
                  type="button" className="sc-x" aria-label={`Remove ${s.label}`}
                  data-testid={`spot-remove-${s.surfaceId}`}
                  onClick={() => onRemove(s.surfaceId)}
                >×</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <button
          type="button" className="sd-chip il-chip sc-spot-add"
          data-testid={`spot-open-${areaId}`} onClick={() => setOpen(true)}
        >+ Point out a spot</button>
      ) : (
        <div className="sc-spot-panel" data-testid={`spot-panel-${areaId}`}>
          <p className="sc-sys-why">
            A photo and a tap. We price the repair from it, and your painter sees it before day one.
          </p>
          <input
            ref={fileRef} type="file" accept="image/*" capture="environment"
            data-testid={`spot-photo-${areaId}`}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="sc-chips" style={{ marginTop: 8 }}>
            {tagsFor(side).map((t) => (
              <button
                key={t.key} type="button" className="sd-chip il-chip"
                disabled={pending != null}
                data-testid={`spot-tag-${areaId}-${t.key}`}
                onClick={() => addSpot(t.key)}
              >{pending === t.key ? "Adding…" : t.label}</button>
            ))}
          </div>
          {error && <p className="sc-spot-err" data-testid={`spot-error-${areaId}`}>{error}</p>}
          <button type="button" className="wz-linkish" onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
        </div>
      )}
    </div>
  );
}
