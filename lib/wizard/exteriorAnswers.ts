/**
 * The exterior ANSWERS, applied to the area nodes — extracted verbatim from
 * the submit route (C15 step 3) so the DRAFT pricer and the SUBMIT path run
 * the same code. Two copies of "storeys give every side its height" is how a
 * drop-out gets valued differently from the estimate they'd have received.
 *
 * What it does (R2, unchanged): lays the four-elevation scaffold when nothing
 * measured the outside; adds the whole-job extras as placeholders; gives
 * unmeasured sides the storey height and typical lengths (tagged assumed);
 * turns condition/access/gear into review deferrals; prices a stated fence
 * length.
 */

import { CLADDING_CODE, CLADDING_LABEL, exteriorExtrasNodes, extSurface, SIZE_BAND_FACTOR, starterExteriorNodes } from "./starter";
import { applyFenceLength } from "./scope-editor";
import { makeDraftSurface } from "@/lib/extract/draft";
import { ALLOWANCE_CODES, rateFor, toggleExtrasItem, WEATHERED_MODIFIER_CODE, type LooseBlock } from "./sides";
import {
  DEFAULT_EXTERIOR_ALLOWANCES, exteriorAccessAllowances,
  type ExteriorAllowanceSettings,
} from "./exterior-allowances";
import { exteriorSides, type WizardState, type WizardSurfaceKey } from "./state";
import type { DraftArea } from "@/lib/extract/draft";

export type MergedBundle = {
  areas: DraftArea[];
  skipped: Array<{ name: string; reason: string }>;
  deferred: Array<{ room: string; areaId: number | null; what: string; count: number; needs: string; kind?: string }>;
  assumedCount: number;
};

/** Per-side numbers that were actually read (site-plan edge widths, facade
 * photo heights) but did not make it into a priced envelope — usually
 * because a photo read a height and no width, which the envelope gate
 * refuses. Tom, 5 Sep 2026: "always gives the same measurement" — these
 * now beat the 12 / 14 × 2.6 (5.5 for a double storey) constants. */
export type MeasuredSides = Partial<Record<"front" | "back" | "left" | "right", { L?: number; H?: number }>>;

export function sideKeyOfName(name: string): keyof MeasuredSides | null {
  const n = name.toLowerCase();
  if (/front/.test(n)) return "front";
  if (/rear|back/.test(n)) return "back";
  if (/left/.test(n)) return "left";
  if (/right/.test(n)) return "right";
  return null;
}

export function applyExteriorAnswers(
  merged: MergedBundle,
  state: WizardState,
  nextId: () => number,
  tickedSurfaces: ReadonlySet<WizardSurfaceKey>,
  measured: MeasuredSides = {},
  /** ⚑ Tom's numbers once he has them; my proposal until then. */
  accessSettings: ExteriorAllowanceSettings = DEFAULT_EXTERIOR_ALLOWANCES,
): void {
  const wantsExterior = state.jobType === "exterior" || state.jobType === "both";
  if (!wantsExterior) return;

  // Feature #2: an exterior/both job that measured NO exterior surfaces still
  // needs the exterior scaffold — otherwise the estimator sees interior only.
  const hasExteriorNodes = merged.areas.some((a) => a.type === "Exterior");
  const house = state.exterior ? state.exterior.targets.includes("house") : true;
  const wantsWalls = !state.exterior || (state.exterior.painting.body && !state.exterior.substrates.includes("none"));
  if (!hasExteriorNodes) {
    const scaffold = starterExteriorNodes(nextId, tickedSurfaces, wantsWalls);
    merged.areas.push(...scaffold.areas);
    merged.deferred = merged.deferred.filter((d) => d.what !== "exterior envelope");
    // Tom, 7 Sep: a job with no house in it (fence, shed, wall, floor only)
    // keeps the four sides as the loop's frame, every one already answered
    // "not painting" — nothing is measured, nothing is priced for them.
    if (house) merged.deferred.push(...scaffold.deferred);
  }

  // A2: ticked whole-job extras are never measured by an elevation read —
  // they always arrive as $0 placeholders to measure.
  const extras = exteriorExtrasNodes(nextId, tickedSurfaces, state.exterior?.extras.fenceType ?? "paling");
  merged.areas.push(...extras.areas);
  merged.deferred.push(...extras.deferred);

  if (!state.exterior) return;
  const ext = state.exterior;

  // Tom, 7 Sep: "Where are we painting?" — a side the customer left unticked
  // arrives in the confirm loop as NOT PAINTING (an option outside the
  // totals and the accuracy score), exactly as if they had skipped it there.
  const painting = new Set<string>(house ? exteriorSides(ext) : []);
  const unwanted = merged.areas.filter((a) => {
    if (a.type !== "Exterior" || a.areaType !== "surface") return false;
    const key = sideKeyOfName(a.name);
    return !!key && !painting.has(key);
  });
  // Tom, 8 Sep 2026: "even though I asked the wizard to only price for the
  // front, left and back, it gave me the right side as an option in the
  // estimate — this shouldn't have been in there." A side the customer never
  // asked about is not a decision they made, so it leaves the estimate
  // altogether rather than sitting on the quote as an exclusion. (A side they
  // OPEN and skip in the confirm loop still shows as NOT PAINTING — that IS
  // a decision, and the quote should say so.)
  //
  // Two floors under it: a house job never loses every side (that would leave
  // the sides editor with nothing to render), and a job with no house in it —
  // fence, shed or wall only — keeps the four as the loop's frame, already
  // answered "not painting", exactly as the 7 Sep ruling set it up.
  const prune = house && unwanted.length > 0 && unwanted.length < merged.areas.filter((a) => a.type === "Exterior" && a.areaType === "surface" && sideKeyOfName(a.name)).length;
  for (const a of unwanted) {
    if (prune) {
      merged.skipped.push({ name: a.name, reason: "not part of the job — the customer named the sides being painted" });
      merged.deferred = merged.deferred.filter((d) => d.areaId !== a.id);
      continue;
    }
    a.isOption = true;
    (a as unknown as { customer?: { include: boolean | null; size: null; confirmed: boolean } }).customer = { include: false, size: null, confirmed: true };
    merged.deferred = merged.deferred.filter((d) => d.areaId !== a.id);
  }
  if (prune) {
    const gone = new Set(unwanted.map((a) => a.id));
    merged.areas = merged.areas.filter((a) => !gone.has(a.id));
  }
  if (house && ext.substrates.includes("other")) {
    merged.deferred.push({
      room: "Exterior", areaId: null, what: "wall cladding", count: 1,
      needs: "customer answered \"other\" for what the house is made of — confirm the substrate on site (scaffolded as weatherboard)",
    });
  }
  applyFreestandingTargets(merged, ext, nextId);

  // Storeys give every side its height; unmeasured sides take typical lengths
  // (12 m front/back, 14 m sides), tagged assumed until the confirm loop
  // settles them.
  /**
   * ⚑ Tom, 10 Sep: a double storey is assumed at 5.5 m, not the 5.2 that was
   * here (and never at an interior ceiling height — the guide range for a
   * two-storey elevation is mostly this number, so getting it low quietly
   * under-quotes every double-storey exterior).
   *
   * It is what the SIDES editor then shows as "about 12 m long × 5.5 m high —
   * sound right?", so the customer corrects it against the real house rather
   * than us guessing twice.
   */
  const sideH = ext.storeys === "double" ? 5.5 : 2.6;
  // Phase 3 (6 Sep plan): the footprint band scales the typical lengths —
  // a 200+ m² home is not 12 m across the front.
  const sideF = SIZE_BAND_FACTOR[ext.sizeBand ?? "unsure"] ?? 1;
  for (const a of merged.areas) {
    if (a.type !== "Exterior" || a.areaType !== "surface") continue;
    const key = sideKeyOfName(a.name);
    const m = key ? measured[key] : undefined;
    if (!(Number(a.H) > 0)) {
      if (m?.H && m.H > 0) {
        a.H = m.H; // read off the facade photo
        a.assumedFields = a.assumedFields.filter((f) => f !== "H");
      } else {
        a.H = sideH;
        if (!a.assumedFields.includes("H")) a.assumedFields = [...a.assumedFields, "H"];
      }
    }
    if (!(Number(a.L) > 0)) {
      if (m?.L && m.L > 0) {
        a.L = m.L; // the floorplan's own edge for this side
        a.assumedFields = a.assumedFields.filter((f) => f !== "L");
      } else {
        a.L = Math.round((/front|rear|back/i.test(a.name) ? 12 : 14) * sideF * 100) / 100;
        if (!a.assumedFields.includes("L")) a.assumedFields = [...a.assumedFields, "L"];
      }
    }
    if (m && (m.L || m.H) && a.origin === "ai_assumed") { a.origin = "ai_extracted"; a.confidence = Math.max(a.confidence, 0.7); }
  }

  // Weathered pricing itself moved to applyConditionPricing (Tom, 31 Aug:
  // condition must be IN the first price, not a jump at the end) — the amber
  // deferral here is only the fallback when the card can't price it.
  if (ext.condition === "peeling") {
    merged.deferred.push({
      room: "Exterior", areaId: null, what: "peeling & flaking paint", count: 1,
      needs: "needs eyes on it before a fixed price — prep scope and (pre-1970) a lead-safe check on the visit",
    });
  }
  // Access allowance pricing lives in applyConditionPricing too — the amber
  // deferral is its fallback when the card carries no allowance row.
  // Tom, 29 Aug: special access equipment is NOT priced by the wizard — the
  // estimator prices hire, delivery and set-up after confirming the need.
  for (const gear of ext.accessEquipment) {
    merged.deferred.push({
      room: "Exterior", areaId: null,
      what: gear === "scissor_lift" ? "scissor lift access"
        : gear === "boom_lift" ? "boom lift access" : "scaffold / platform access",
      count: 1,
      needs: "customer says this equipment is needed — NOT priced in the estimate; confirm hire, delivery and set-up with them",
    });
  }

  /**
   * GETTING TO THE WORK (allowances spec §8, which does not exist — these are
   * my proposed figures, Settings-editable, and every job that uses one is
   * flagged so actuals can correct them).
   *
   * Flat hours, not multipliers: a second storey does not slow the brush down,
   * it adds set-up and pack-down, and that costs the same whether the wall is
   * 6 m or 16 m. Applied per SIDE BEING PAINTED, so a job that named three
   * sides is not charged for four.
   */
  const sidesPainted = merged.areas.filter((a) =>
    a.type === "Exterior" && a.areaType === "surface" && sideKeyOfName(a.name) != null
    && a.isOption !== true).length;
  const access = exteriorAccessAllowances({
    storeys: ext.storeys,
    access: ext.access,
    accessEquipment: ext.accessEquipment,
    sidesPainted,
  }, accessSettings);
  merged.deferred.push(...access.deferred);
  if (access.allowances.length > 0) {
    const lines = access.allowances.map((a) => {
      const line = makeDraftSurface(nextId(), `Exterior Access — ${a.label}`, a.label, 1, "customer_stated", 0.9, ["prep"]);
      line.prepHr = a.hours;
      line.crewNote = a.note;
      return line;
    });
    merged.areas.push({
      id: nextId(), kind: "area", name: "Exterior - Access", type: "Exterior", areaType: "surface",
      roomType: "exterior", storey: "ground", L: 0, W: 0, H: 0,
      isOption: false, description: "", open: false, media: [],
      origin: "customer_stated", confidence: 0.9, assumedFields: [], extractionSourceId: null,
      surfaces: lines,
    } as unknown as (typeof merged.areas)[number]);
  }
  if (ext.extras.fence && ext.extras.fenceType === "metal") {
    merged.deferred.push({
      room: "Exterior", areaId: null, what: "metal fence", count: 1,
      needs: `${ext.extras.fenceMetres != null ? `about ${ext.extras.fenceMetres} m of ` : ""}metal fence — no rate on the card yet; your estimator prices it`,
    });
  } else if (ext.extras.fence) {
    if (ext.extras.fenceMetres != null) {
      const priced = applyFenceLength(merged.areas as unknown as Parameters<typeof applyFenceLength>[0], ext.extras.fenceMetres);
      if (priced.ok) {
        merged.areas = priced.blocks as unknown as typeof merged.areas;
        merged.deferred = merged.deferred.filter((d) => !/fence/i.test(d.what));
      }
    } else {
      merged.deferred.push({
        room: "Exterior", areaId: null, what: "fence length", count: 1,
        needs: "customer isn't sure of the fence length — measure it on site",
      });
    }
  }
}

/**
 * Tom, 7 Sep: the freestanding targets — a shed (priced by the card's Shed
 * row, its cladding noted), a wall (the cladding rate over an assumed
 * 1.8 m height and the stated or a typical length), floor coatings (no rate
 * row: the estimator prices them). Each lands on "Exterior - Extras" or its
 * own area, and each says what was assumed.
 */
function applyFreestandingTargets(merged: MergedBundle, ext: NonNullable<WizardState["exterior"]>, nextId: () => number): void {
  const extrasArea = () => {
    let a = merged.areas.find((x) => x.type === "Exterior" && x.name === "Exterior - Extras");
    if (!a) {
      a = {
        id: nextId(), kind: "area", name: "Exterior - Extras", type: "Exterior", areaType: "surface",
        roomType: "exterior", storey: "ground", L: 0, W: 0, H: 0,
        isOption: false, description: "", open: false, media: [],
        origin: "ai_assumed", confidence: 0.4, assumedFields: ["exterior_envelope"], extractionSourceId: null,
        surfaces: [],
      } as unknown as MergedBundle["areas"][number];
      merged.areas.push(a);
    }
    return a;
  };
  if (ext.targets.includes("shed")) {
    const a = extrasArea();
    const sub = ext.shed?.substrate ?? "colorbond";
    const line = extSurface(nextId(), "Shed");
    line.internalLabel = `Shed (${CLADDING_LABEL[sub] ?? sub})`;
    line.clientLabel = "Garage / workshop / shed";
    line.crewNote = `shed cladding: ${CLADDING_LABEL[sub] ?? sub}`;
    a.surfaces.push(line);
    merged.deferred.push({
      room: "Exterior - Extras", areaId: a.id, what: "shed", count: 1,
      needs: `${CLADDING_LABEL[sub] ?? sub} shed — priced at the card's Shed allowance; confirm its size on site`,
    });
  }
  if (ext.targets.includes("wall")) {
    const sub = ext.wall?.substrate ?? "brick";
    const code = CLADDING_CODE[sub] ?? "Brick";
    const L = ext.wall?.metres ?? 10;
    const id = nextId();
    const line = extSurface(nextId(), code);
    line.internalLabel = `${code} — freestanding wall`;
    line.clientLabel = "Wall";
    merged.areas.push({
      id, kind: "area", name: "Exterior - Wall", type: "Exterior", areaType: "surface",
      roomType: "exterior", storey: "ground", L, W: 0, H: 1.8,
      isOption: false, description: "Freestanding / boundary wall", open: false, media: [],
      origin: "ai_assumed", confidence: 0.4,
      assumedFields: ["H", ...(ext.wall?.metres != null ? [] : ["L"])], extractionSourceId: null,
      surfaces: [line],
    } as unknown as MergedBundle["areas"][number]);
    merged.deferred.push({
      room: "Exterior - Wall", areaId: id, what: "freestanding wall", count: 1,
      needs: ext.wall?.metres != null
        ? `${CLADDING_LABEL[sub] ?? sub} wall, about ${L} m long — height assumed 1.8 m, confirm on site`
        : `${CLADDING_LABEL[sub] ?? sub} wall — length and height assumed (10 m × 1.8 m), measure on site`,
    });
  }
  if (ext.targets.includes("floor")) {
    merged.deferred.push({
      room: "Exterior", areaId: null, what: "floor coating", count: 1,
      needs: `floor coating${ext.floor?.m2 != null ? ` over about ${ext.floor.m2} m²` : ""} — no rate on the card; your estimator prices the product and preparation`,
    });
  }
}

/** The slice of the pricing context this module needs — structural, so both
 * the submit route and the draft pricer can hand their ctx straight in. */
type ConditionCtx = {
  modifiers: ReadonlyArray<{ code: string; multiplier: number }>;
  rateItems: ReadonlyArray<{
    code: string; category: string;
    rate_2_coat?: number | null; charge_out_cents?: number | null;
  }>;
};

/** The builder's interior condition modifier for damage-tier answers. */
export const INTERIOR_POOR_MODIFIER_CODE = "COND-POOR";

/**
 * Tom, 31 Aug: the condition answers "adjust the quote quite substantially",
 * so they must be IN the price from the FIRST reveal — worst case up front,
 * never a jump when the confirm loop re-asks at the end.
 *
 * Prices what the wizard already asked, the same way the loop's Condition
 * card does (wizard-edit `loop_cond`):
 *  - exterior "weathered" → the EXT-WEATHERED labour modifier;
 *  - any ticked exterior access answer → the flat Access Allowance row;
 *  - interior damage tier ≥ 2 → the builder's Poor condition modifier.
 * When two condition modifiers apply (a Both job), the WORSE multiplier wins.
 * A code the live card can't price falls back to the amber deferral — the
 * pre-31-Aug behaviour, never a silent $0.
 *
 * Returns the modSel patch for builder_state; mutates merged.areas (the
 * allowance line) and merged.deferred (fallbacks) in place.
 */
/** The Staging modifier for a lived-in home (rate card v7 seed). */
export const OCCUPIED_MODIFIER_CODE = "STG-OCCUPIED";

export function applyConditionPricing(
  merged: MergedBundle,
  state: WizardState,
  nextId: () => number,
  ctx: ConditionCtx,
): Record<string, string> {
  const modSel: Record<string, string> = {};
  const findMod = (code: string) => ctx.modifiers.find((m) => m.code === code) ?? null;

  const candidates: Array<{ code: string; multiplier: number }> = [];

  if ((state.jobType === "exterior" || state.jobType === "both") && state.exterior) {
    const ext = state.exterior;
    if (ext.condition === "weathered") {
      const mod = findMod(WEATHERED_MODIFIER_CODE);
      if (mod) candidates.push(mod);
      else merged.deferred.push({
        room: "Exterior", areaId: null, what: "weathered paintwork", count: 1,
        needs: "extra preparation allowed for — confirm the prep scope at review",
      });
    }
    // Peeling & flaking IS the card's "Poor — flaking / peeling" (Tom, 3 Sep:
    // a job marked poor must carry the extra prep hours for the painter). It
    // priced NOTHING before — only the site-visit deferral, which
    // applyExteriorAnswers still raises. Worst-case number up front (the 31
    // Aug rule), and the visit still confirms it.
    if (ext.condition === "peeling") {
      const mod = findMod(INTERIOR_POOR_MODIFIER_CODE);
      if (mod) candidates.push(mod);
    }
    if (ext.access.length > 0) {
      const r = rateFor(ctx.rateItems, ALLOWANCE_CODES.access.code);
      const res = r
        ? toggleExtrasItem(
            merged.areas as unknown as LooseBlock[],
            ALLOWANCE_CODES.access.code, ALLOWANCE_CODES.access.label, true,
            nextId, r.chargeOutDollars,
          )
        : null;
      if (res?.ok) merged.areas = res.blocks as unknown as typeof merged.areas;
      else {
        for (const acc of ext.access) {
          merged.deferred.push({
            room: "Exterior", areaId: null,
            what: acc === "steep" ? "steep block" : acc === "tight" ? "tight side access" : "double-height entry",
            count: 1, needs: "access affects setup time — allow for it at review",
          });
        }
      }
    }
  }

  if (state.jobType !== "exterior" && state.details.damageTier >= 2) {
    const mod = findMod(INTERIOR_POOR_MODIFIER_CODE);
    if (mod) candidates.push(mod);
    // No fallback deferral: tier ≥ 2 already demands photos, which raise
    // their own damage-to-price deferral through the defect reader.
  }

  // Tom, 7 Sep 2026: a lived-in home is set up and packed down every day —
  // the Staging modifier prices it. Coverings may not be able to stay down
  // between visits, so the price can still move; the deferral says so on the
  // estimate and the estimator talks it through before anything is fixed.
  if (state.jobType !== "exterior" && state.details.occupied === "yes") {
    const mod = findMod(OCCUPIED_MODIFIER_CODE);
    if (mod) modSel.Staging = mod.code;
    merged.deferred.push({
      room: "Whole job", areaId: null, what: "living there while we paint", count: 1,
      needs: mod
        ? "daily set-up and pack-down is allowed for; the price may vary depending on whether our coverings can stay down between visits — we'll talk it through with you"
        : "daily set-up and pack-down to allow for — confirm at review",
    });
  }

  // One Condition slot in modSel — the worst case wins, per Tom's ruling.
  const worst = candidates.sort((a, b) => b.multiplier - a.multiplier)[0];
  if (worst) modSel.Condition = worst.code;
  return modSel;
}
