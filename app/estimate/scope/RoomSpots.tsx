"use client";

import { useRef, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  EXTENT_LABEL, prepPrompt, ROOM_CONDITION_LABEL, ROOM_CONDITIONS, SPOT_EXTENTS, tagsFor,
  type RoomCondition, type SpotExtent,
} from "@/lib/wizard/spots";
import { suggestionLine, type SuggestedSpot } from "@/lib/wizard/photo-defects";
import PhotoDrop from "./PhotoDrop";
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
  estimateId, areaId, roomName, side, spots, condition, colourTier = "change", busy, onAdd, onRemove, onCondition,
}: {
  estimateId: string;
  areaId: number;
  roomName: string;
  side: "interior" | "exterior";
  spots: RoomSpot[];
  condition: RoomCondition;
  /** The job's colour intent — it decides what this room is asked to look for. */
  colourTier?: "fresh" | "change" | "dark_to_light";
  busy?: boolean;
  onAdd: (tag: string, extent: SpotExtent, sourceId: string | null) => void;
  onRemove: (surfaceId: number) => void;
  onCondition: (c: RoomCondition) => void;
}) {
  const prompt = prepPrompt(colourTier);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  // Tom, 9 Sep: two spots of peeling is not a peeling house. "A couple of
  // spots" is the safe floor, so it is the one that starts selected.
  const [extent, setExtent] = useState<SpotExtent>("spots");
  // What the photo reader thinks it can see — offered for confirmation, never
  // applied behind them (lib/wizard/photo-defects.ts).
  const [suggested, setSuggested] = useState<SuggestedSpot | null>(null);
  const [reading, setReading] = useState(false);

  /**
   * Upload as soon as the photo is CHOSEN, not when the tag is tapped.
   *
   * The whole point is that the reading arrives before the customer answers —
   * a suggestion offered after they have already tagged it is a suggestion
   * nobody needs. It also means the slow part happens while they are reading
   * the question rather than while they wait on a button.
   */
  async function onFileChosen(f: File | null) {
    setSuggested(null);
    setSourceId(null);
    if (!f) return;
    setReading(true);
    setError(null);
    try {
      const r = await uploadPhoto(f);
      setSourceId(r.sourceId);
      if (r.suggestion) {
        setSuggested(r.suggestion);
        setExtent(r.suggestion.extent);
      }
    } catch (e) {
      // The spot is still worth recording — the photo is evidence, not the point.
      setError(e instanceof Error ? `${e.message} You can still tell us what it is.` : "That photo didn't upload — you can still tell us what it is.");
    } finally {
      setReading(false);
    }
  }

  /** Stage one photo, claim it, and read it. */
  async function uploadPhoto(file: File): Promise<{ sourceId: string | null; suggestion: SuggestedSpot | null }> {
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
        // Phase 9: read it, so the customer confirms rather than types.
        analyse: true,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? "That photo couldn't be saved.");
    const ids: string[] = Array.isArray(j.sourceIds) ? j.sourceIds : [];
    const per = Array.isArray(j.perPhoto) ? j.perPhoto : [];
    return { sourceId: ids[0] ?? null, suggestion: per[0]?.suggestion ?? null };
  }

  function addSpot(tag: string) {
    if (busy || pending || reading) return;
    setPending(tag);
    onAdd(tag, extent, sourceId);
    setSourceId(null);
    setSuggested(null);
    setExtent("spots");
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
        >{prompt.cta}</button>
      ) : (
        <div className="sc-spot-panel" data-testid={`spot-panel-${areaId}`}>
          <p className="sc-sys-why">{prompt.why}</p>
          <p className="sc-sys-why">
            A photo and a tap. With a photo we can price the repair straight away; without one we still
            record it and one of our people prices it. Either way your painter sees it before day one.
          </p>
          <PhotoDrop
            inputRef={fileRef}
            testId={`spot-photo-${areaId}`}
            title="Take a photo of the spot"
            hint="With a photo we price the repair straight away. Without one, a person prices it."
            ready={sourceId ? "Photo added" : null}
            disabled={reading}
            onFiles={(f) => void onFileChosen(f[0] ?? null)}
          />
          {reading && <p className="sc-sys-why" data-testid={`spot-reading-${areaId}`}>Reading your photo…</p>}
          {suggested && (
            <p className="sc-spot-suggest" data-testid={`spot-suggestion-${areaId}`}>{suggestionLine(suggested)}</p>
          )}
          <p className="sc-sys-why" style={{ marginTop: 10, marginBottom: 4 }}>How much of it is there?</p>
          <div className="sc-chips">
            {SPOT_EXTENTS.map((e) => (
              <button
                key={e} type="button"
                className={`sd-chip il-chip ${extent === e ? "on" : ""}`}
                aria-pressed={extent === e}
                data-testid={`spot-extent-${areaId}-${e}`}
                onClick={() => setExtent(e)}
              >{EXTENT_LABEL[e]}</button>
            ))}
          </div>
          <p className="sc-sys-why" style={{ marginTop: 10, marginBottom: 4 }}>What is it?</p>
          <div className="sc-chips">
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
