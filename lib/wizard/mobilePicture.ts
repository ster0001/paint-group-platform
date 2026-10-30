import type { QuickLook } from "./quick-look";
import type { ExteriorQuickLook } from "./exterior-quick-look";
import type { ExteriorPart, ExteriorV2 } from "./state";
import { colourChoiceOf, paintParts, sideStatusLine, surfaceChips, surfacesTicked, type ColourChoice, type MobileScreen } from "./mobileScreens";
import { PART_LABEL } from "./exterior-model";
import { scaledLengths, typicalFor, type ExteriorTypicalRow, type SizeBand } from "./exterior-typicals";

/**
 * Wizard mobile v5, session 3 (brief §3) — the live strip's PICTURE and
 * RIBBON, as data.
 *
 * One picture state is drawn twice (the 76 × 52 thumbnail in the strip and
 * the 5:3 picture in the sheet) from the answers so far: Inside → the room,
 * Outside → the house; a unit is a block with balconies and three window
 * rows, a townhouse a split house with two doors, two storeys a second
 * window row; the colours tint the walls, the condition adds marks; each
 * surface is a base layer plus a painted layer the roller sweeps in (§3.1–3.3).
 * Before the surfaces screen the picture is unpainted; from it on, the ticks
 * persist through colours and condition (§3.5).
 *
 * Pure: nothing here knows React or the DOM. `app/wizard/pictures/MobilePicture.tsx`
 * draws it; `app/wizard/MobileStrip.tsx` holds the strip and the sheet.
 */

/** The surfaces the picture can paint. Inside: five; outside (brief §3.2's set): six, the verandah on a house only. */
export const INSIDE_PICTURE_SURFACES = ["walls", "ceilings", "skirting", "doors", "windows"] as const;
export const OUTSIDE_PICTURE_SURFACES = ["walls", "eaves", "gutters", "windows", "doors", "verandah"] as const;
export type PictureSurface = (typeof INSIDE_PICTURE_SURFACES)[number] | (typeof OUTSIDE_PICTURE_SURFACES)[number];

export type PictureProperty = "house" | "townhouse" | "unit_apartment";

export type MobilePictureState = {
  kind: "room" | "house";
  property: PictureProperty;
  two: boolean;
  colour: ColourChoice;
  condition: QuickLook["condition"];
  /** Which surfaces are painted; null = before the surfaces screen, every surface unpainted. */
  painted: Partial<Record<PictureSurface, boolean>> | null;
};

/** §3.1 — the wall tints: New soft green, Same cream, Still deciding pale teal. */
export const WALL_TINT: Record<ColourChoice, string> = { new: "#cfe3d6", same: "#f1efe9", deciding: "#dcecef" };

/**
 * The exterior brief's parts, grouped onto the picture's six outside
 * surfaces (brief §2.4: the mechanic works with whatever that brief's
 * surfaces are). The first part of a group is the one a sheet chip toggles.
 */
export const OUTSIDE_SURFACE_PARTS: Record<(typeof OUTSIDE_PICTURE_SURFACES)[number], ExteriorPart[]> = {
  walls: ["walls", "gable"],
  eaves: ["fascias", "eaves"],
  gutters: ["gutters", "downpipes"],
  windows: ["windows", "shutters"],
  doors: ["doors", "garage"],
  verandah: ["verandah", "posts", "ceiling", "handrail"],
};
export const OUTSIDE_SURFACE_LABEL: Record<(typeof OUTSIDE_PICTURE_SURFACES)[number], string> = {
  walls: "Walls", eaves: "Eaves & fascia", gutters: "Gutters & downpipes", windows: "Window frames", doors: "Doors", verandah: "Verandah",
};

function outsideProperty(v2: ExteriorV2 | null | undefined, fallback: QuickLook["propertyKind"]): PictureProperty {
  if (v2?.propertyType === "th" || v2?.propertyType === "terrace") return "townhouse";
  if (v2?.propertyType === "unit") return "unit_apartment";
  if (v2) return "house";
  return fallback === "townhouse" ? "townhouse" : fallback === "unit_apartment" ? "unit_apartment" : "house";
}

/** The picture for these answers. `surfacesReached`: the surfaces screen has been shown (inside). */
export function pictureStateFor(quick: QuickLook, outside: ExteriorQuickLook | null, surfacesReached: boolean): MobilePictureState {
  if (quick.jobType === "exterior") {
    const v2 = outside?.v2 ?? null;
    const painted: Partial<Record<PictureSurface, boolean>> | null = v2 && v2.parts.length > 0
      ? Object.fromEntries(OUTSIDE_PICTURE_SURFACES.map((k) => [k, OUTSIDE_SURFACE_PARTS[k].some((p) => v2.parts.includes(p))]))
      : null;
    return {
      kind: "house",
      property: outsideProperty(v2, quick.propertyKind),
      two: v2 ? v2.propertyType === "ds" : (outside?.storeys ?? "single") === "double",
      colour: outside?.colour === "same" ? "same" : "new",
      condition: quick.condition,
      painted,
    };
  }
  const property: PictureProperty = quick.propertyKind === "townhouse" ? "townhouse" : quick.propertyKind === "unit_apartment" ? "unit_apartment" : "house";
  const painted = surfacesReached
    ? Object.fromEntries(surfaceChips(quick).filter((c) => (INSIDE_PICTURE_SURFACES as readonly string[]).includes(c.key)).map((c) => [c.key, c.on])) as Partial<Record<PictureSurface, boolean>>
    : null;
  return { kind: "room", property, two: quick.storeys === "double", colour: colourChoiceOf(quick), condition: quick.condition, painted };
}

/**
 * The sheet's chips on an outside job — exterior on mobile v5 (S2): one per
 * PART the Painting screens offer, in their order, each toggling itself
 * (the drawn house lights it; one control, two places). Before a shape there
 * is nothing to tick.
 */
export function outsideSheetChips(v2: ExteriorV2 | null | undefined): Array<{ key: ExteriorPart; label: string; part: ExteriorPart; on: boolean }> {
  if (!v2) return [];
  return paintParts(v2).map((part) => ({ key: part, label: PART_LABEL[part], part, on: v2.parts.includes(part) }));
}

const PROPERTY_WORD: Record<QuickLook["propertyKind"], string> = { house: "House", townhouse: "Townhouse", unit_apartment: "Unit or apartment", commercial: "Commercial" };
const JOB_WORD: Record<QuickLook["scope"], string> = { whole: "Whole interior", some_rooms: "Some rooms", walls_ceilings: "Walls and ceilings", trims_doors: "Doors, windows and trims" };
const COLOUR_WORD: Record<ColourChoice, string> = { new: "New colours", same: "Same colours", deciding: "Still deciding" };
const CONDITION_WORD: Record<QuickLook["condition"], string> = { good: "Good, just tired", wear: "Some wear", needs_work: "Needs work" };

/** Exterior on mobile v5 — the size band in a word (the ribbon, the sheet's caption). */
export const SIZE_WORD: Record<SizeBand, string> = { sm: "Small", md: "Medium", lg: "Large", xl: "Very large", ns: "Not sure" };

/**
 * Exterior on mobile v5, session 1 (plan §2 screen 3, §3): the sheet's caption
 * under the drawn house — the shape, the size, the storeys and the typical
 * sizes in words, the desktop picture card's words shortened to one line.
 */
export function elevationCaption(v2: ExteriorV2, rows: ReadonlyArray<ExteriorTypicalRow> = []): string {
  const t = typicalFor(v2.propertyType, rows);
  const l = scaledLengths(t, v2.sizeBand ?? "ns");
  const size = v2.sizeBand ? ` · ${SIZE_WORD[v2.sizeBand]}` : "";
  return `${t.name}${size} · ${t.storeys === 2 ? "two storeys" : "single storey"} · about ${l.frontM} m across, ${t.wallHM} m to the ${t.roof === "parapet" ? "parapet" : "gutter"}`;
}

export type Ribbon = { line1: string; line2: string };

/**
 * §2.2 — the ribbon: the answers given so far joined with " · " (a screen
 * counts as answered once the customer has moved past it), e.g. "Inside ·
 * House · 3 bed · Two storeys · Whole interior · 8 rooms · New colours ·
 * Some wear"; the second line "N surfaces ticked · tap to see" once
 * surfaces exist, else "Updates as you answer · tap to see".
 */
export function ribbonFor(i: {
  quick: QuickLook; outside: ExteriorQuickLook | null; screens: readonly MobileScreen[]; index: number; roomsTicked: number;
  rows?: ReadonlyArray<ExteriorTypicalRow>;
  /** S7: a both job on an exterior step — the outside's second line, the shape and size on the first. */
  outsideNow?: boolean;
}): Ribbon {
  const { quick, screens, index } = i;
  const passed = new Set(screens.slice(0, index).map((s) => s.id));
  const parts: string[] = [];
  const outsideNow = i.outsideNow ?? quick.jobType === "exterior";
  const v2 = outsideNow ? i.outside?.v2 ?? null : null;
  if (passed.has("what")) parts.push(quick.jobType === "exterior" ? "Outside" : quick.jobType === "both" ? "Inside and outside" : "Inside");
  // Exterior on mobile v5 (plan §3): once the shape is given it names the home in place of the place's kind.
  if (passed.has("property") && !(v2 && passed.has("shape"))) parts.push(PROPERTY_WORD[quick.propertyKind]);
  if (v2 && passed.has("shape")) parts.push(typicalFor(v2.propertyType, i.rows ?? []).name);
  if (v2 && passed.has("size") && v2.sizeBand) parts.push(SIZE_WORD[v2.sizeBand]);
  if (passed.has("beds")) parts.push(`${quick.bedrooms >= 5 ? "5+" : quick.bedrooms} bed`);
  if (passed.has("storeys")) parts.push(quick.storeys === "double" ? "Two storeys" : "Single storey");
  if (passed.has("job")) parts.push(JOB_WORD[quick.scope]);
  if (passed.has("rooms")) parts.push(`${i.roomsTicked} room${i.roomsTicked === 1 ? "" : "s"}`);
  if (passed.has("colours")) parts.push(COLOUR_WORD[colourChoiceOf(quick)]);
  if (passed.has("condition")) parts.push(CONDITION_WORD[quick.condition]);
  const line1 = parts.length ? parts.join(" · ") : "Your place";
  const surfacesAt = screens.findIndex((s) => s.id === "surfaces");
  if (outsideNow) {
    // S4 (plan §3): on the side screens the second line is the sides' state
    if (v2 && screens[index]?.step === "sides") return { line1, line2: sideStatusLine(v2) };
    const n = i.outside?.v2?.parts.length ?? 0;
    const paintAt = screens.findIndex((s) => s.step === "paint");
    return { line1, line2: paintAt >= 0 && index >= paintAt ? `${n} part${n === 1 ? "" : "s"} ticked · tap to see` : "Updates as you answer · tap to see" };
  }
  if (surfacesAt >= 0 && index >= surfacesAt) {
    const n = surfacesTicked(quick);
    return { line1, line2: `${n} surface${n === 1 ? "" : "s"} ticked · tap to see` };
  }
  return { line1, line2: "Updates as you answer · tap to see" };
}
