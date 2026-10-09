"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { QuickLook, QuickLookStep } from "@/lib/wizard/quick-look";
import { paintedSurfaces } from "@/lib/wizard/quick-look";
import HousePicture from "./pictures/HousePicture";
import RoomPicture, { type RoomSurface } from "./pictures/RoomPicture";
import PlanMap, { type PlanRoom } from "./pictures/PlanMap";
import PlanViewer from "./PlanViewer";

/**
 * The picture card (UI refresh S2, brief §7.2; components doc §4) — the live
 * picture of the job beside the questions, with a one-sentence caption.
 *
 * Which picture follows the step: the house on Address and Place, the room on
 * the Job, Condition and details steps, the floor plan on Rooms (or the
 * customer's own floorplan, zoomable, once it has been read). The outside
 * picture, the view from above and the warehouse are S5 and S7's; until then
 * those steps show the house.
 *
 * ⚑ 1 (colour try-on swatches) is OFF (`UI_FLAGS.colourTryOn`): the walls take one neutral
 * fresh tone and no swatches are drawn until Tom rules.
 *
 * The art box is a fixed 4:3 and `aria-hidden`; the caption is real text, and
 * every answer the picture shows is also in words on the left.
 */
const GLOSS: Record<RoomSurface, string> = {
  walls: "every wall in the rooms you pick.",
  ceilings: "includes the cornice where it meets the wall.",
  cornices: "the moulding where the walls meet the ceiling.",
  skirting: "the timber strip along the bottom of each wall.",
  architraves: "the timber frame around each door.",
  doors: "both sides and the edges.",
  windows: "the frame and sill, not the glass.",
};
const NAME: Record<RoomSurface, string> = {
  walls: "Walls", ceilings: "Ceilings", cornices: "Cornices", skirting: "Skirting boards",
  architraves: "Architraves", doors: "Doors", windows: "Window frames",
};
const KIND: Record<QuickLook["propertyKind"], string> = { house: "House", townhouse: "Townhouse", unit_apartment: "Unit or apartment", commercial: "Commercial" };
const CONDITION: Record<string, [string, string]> = {
  good: ["Good, just tired.", "Sound surfaces. A light sand and it is ready."],
  wear: ["Some wear.", "Scuffs, marks, the odd hairline crack or nail hole."],
  needs_work: ["Needs work.", "Flaking, cracked plaster, water marks or damage."],
};

export default function PictureCard({ step, quick, suburb, rooms, planPreviewUrl, planPending, segmentName }: {
  step: QuickLookStep;
  quick: QuickLook;
  /** The suburb from the address, for the house card's tag. */
  suburb: string | null;
  /** The rooms step's list, with what is left out. */
  rooms: PlanRoom[];
  planPreviewUrl: string | null;
  planPending: boolean;
  segmentName: string | null;
}) {
  const interior = quick.jobType !== "exterior" && quick.propertyKind !== "commercial";
  const which: "house" | "room" | "plan" =
    interior && (step === "job" || step === "condition" || step === "gate") ? "room"
      : interior && step === "rooms" ? "plan"
        : "house";

  const painted = useMemo(() => paintedSurfaces(quick.scope, quick.excluded), [quick.scope, quick.excluded]);
  // The surface just ticked or unticked: outlined for two seconds and named in the caption.
  const prev = useRef<string[]>(painted);
  const [touched, setTouched] = useState<RoomSurface | null>(null);
  useEffect(() => {
    const before = new Set<string>(prev.current);
    const now = new Set<string>(painted);
    const changed = [...painted.filter((s) => !before.has(s)), ...prev.current.filter((s) => !now.has(s))]
      .find((s) => s !== "cornices") as RoomSurface | undefined;
    prev.current = painted;
    if (!changed) return;
    setTouched(changed);
    const t = setTimeout(() => setTouched(null), 2100);
    return () => clearTimeout(t);
  }, [painted]);

  const onCount = rooms.filter((r) => r.state !== "off").length;
  let title = "Your place";
  let tag = suburb ?? "";
  let note: React.ReactNode = null;
  if (which === "room") {
    title = step === "condition" ? "A room today" : step === "gate" ? "Ready to price" : "A room, once we’ve painted";
    tag = step === "condition" ? "" : `${painted.filter((s) => s !== "cornices").length} surfaces`;
    note = step === "condition"
      ? <><b>{CONDITION[quick.condition]?.[0]}</b> {CONDITION[quick.condition]?.[1]}</>
      : step === "gate"
        ? "That’s everything we need. Your guide range appears as soon as you add your details."
        : touched
          ? <><b>{NAME[touched]}</b>: {GLOSS[touched]}</>
          : "Tick or untick a surface and it paints in or out of the picture.";
  } else if (which === "plan") {
    title = planPreviewUrl ? "Your floorplan" : "Your rooms";
    tag = `${onCount} to paint`;
    note = planPending && !planPreviewUrl
      ? "Reading your floorplan. The rooms appear here as soon as it finishes."
      : planPreviewUrl
        ? "Pinch or use + to zoom. Drag to look around."
        : "Dashed rooms are left out. Tap a room in the list to bring it back.";
  } else {
    if (quick.propertyKind === "commercial") title = "Your building";
    note = step === "start"
      ? (quick.jobType === "interior" ? "Inside only. The lights are on." : quick.jobType === "exterior" ? "Outside only. The walls are getting a fresh coat." : "Inside and out.")
      : step === "both"
        ? "Inside and out. Two ranges, added together."
        : step === "place"
          ? quick.propertyKind === "commercial"
            ? "A commercial property. Next: what kind of space."
            : `${KIND[quick.propertyKind]}${quick.jobType === "exterior" ? "" : `, ${quick.bedrooms >= 5 ? "5 or more" : quick.bedrooms} bedroom${quick.bedrooms === 1 ? "" : "s"}, ${quick.storeys === "double" ? "two storeys" : "single storey"}`}.`
          : step === "segment"
            ? (segmentName ? <><b>{segmentName}.</b> Pick the closest kind of place.</> : "Pick the closest kind of place.")
            : null;
  }

  return (
    <div className="wz-pic" data-testid="ql-picture" data-picture={which}>
      <div className="wz-pic-head"><b>{title}</b>{tag && <span>{tag}</span>}</div>
      <div className={`wz-pic-art ${which === "plan" && planPreviewUrl ? "real" : ""}`}>
        {which === "house" && <HousePicture kind={quick.propertyKind} storeys={quick.storeys} jobType={quick.jobType} />}
        {which === "room" && (
          <RoomPicture painted={painted} today={step === "condition"} condition={quick.condition} occupied={quick.occupied === "yes"}
            highlight={step === "job" ? touched : null} />
        )}
        {which === "plan" && (planPreviewUrl ? (
          // Tom, 7 Oct 2026 (item 3): the plan is zoomable here too — pinch, the wheel, or + / −, and drag to pan.
          <figure className="wz-planpreview" data-testid="ql-plan-preview">
            <PlanViewer src={planPreviewUrl} title="Your floorplan" note="Pinch or use + to zoom" />
          </figure>
        ) : planPending ? (
          <div className="wz-pic-reading" role="status" aria-live="polite" data-testid="ql-picture-reading">
            <p className="on"><i aria-hidden="true" /> Finding the rooms on the plan</p>
            <p><i aria-hidden="true" /> Reading each room&rsquo;s measurements</p>
            <p><i aria-hidden="true" /> Listing them for you to confirm</p>
          </div>
        ) : <PlanMap rooms={rooms} />)}
      </div>
      {note && <p className="wz-pic-note" data-testid="ql-picture-note">{note}</p>}
    </div>
  );
}
