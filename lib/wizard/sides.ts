import { sideGateError } from "./required-questions";
import { makeDraftSurface } from "@/lib/extract/draft";
import { substrateKeyForRateCode } from "@/lib/estimate/substrates";

/**
 * R2b: the exterior confirm-loop, BY SIDES (rebuild addendum §0; reference
 * mockup customer-review-confirm-exterior-v2-sides.html).
 *
 * Pure functions over the SAME area tree everything else reads: the four
 * "Exterior - Front/Left/Right/Rear" elevation nodes the wizard scaffolds.
 * The wizard-edit route applies these and reprices via lib/pricing — the
 * editor computes nothing.
 *
 * State model:
 *  - per side, customer answers ride ON the block: `customer.include`
 *    (are we painting this side), `customer.size` (yes/adjusted/ns),
 *    `customer.confirmed`. A skipped side sets `isOption: true` — pricing
 *    already leaves options out of the total, and the quote renders it as an
 *    explicit exclusion.
 *  - wall lines carry `sharePct`; their measureL/measureH derive from the
 *    side's L×H × share, so the engine prices share × the line's own rate
 *    (substrate factors are just different rate items — no factor math).
 *  - window lines carry `sizeBand` (S/M/L); qtyOverride = count × factor.
 *  - the non-side loop items (extras / condition / totals check / sweep)
 *    keep their answers in builder_state.sidesLoop.
 */

export type SideKey = "front" | "left" | "right" | "back";
export const SIDE_KEYS: SideKey[] = ["front", "left", "right", "back"];

const SIDE_MATCH: Record<SideKey, RegExp> = {
  front: /front/i, left: /left/i, right: /right/i, back: /rear|back/i,
};

export const SIDE_LABEL: Record<SideKey, string> = {
  front: "Front — street side", left: "Left side", right: "Right side", back: "Back",
};

/** Wall substrates a side can carry — data-driven from the rate card at the
 * route (these are the codes the scaffold and the registry use). */
export const WALL_CODES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "Weatherboards", label: "Weatherboard cladding" },
  { code: "Render", label: "Render" },
  // Tilt slab / precast concrete panel — priced as a clone of render
  // (migration 20261204), named for what the customer actually has.
  { code: "Concrete / Tilt Slab", label: "Tilt slab / concrete" },
  { code: "Stucco", label: "Stucco" },
  { code: "Brick", label: "Painted brick" },
  // Bare brick — sealer plus two topcoats. Its rate row carries
  // default_coats 3 (migration 20260925); the line reads the card.
  { code: "Brick (Unpainted)", label: "Unpainted brick (3 coats)" },
];

/**
 * The wall substrates the LIVE card can actually price. A tick that cannot
 * price is never offered (the substrate-registry rule), which is what keeps
 * "Tilt slab / concrete" out of the add panel until migration 20261204 has
 * run — and what kept unpainted brick out before 20260925.
 */
export function wallOptionsFromRates(
  rateItems: ReadonlyArray<{ code: string | null; category: string | null }>,
): Array<{ code: string; label: string }> {
  const priced = new Set(rateItems.filter((r) => r.category === "Exterior").map((r) => r.code ?? ""));
  return WALL_CODES.filter((w) => priced.has(w.code)).map((w) => ({ ...w }));
}

/** S/M/L window factors — mirror of the interior multipliers (Settings own
 * the numbers; these are the locked defaults). */
export const WINDOW_FACTOR: Record<"S" | "M" | "L", number> = { S: 0.8, M: 1, L: 1.2 };

/**
 * Parity STOP-item 1 (Tom's price list, 20 Aug 2026): catalogue items the
 * add-panel offers PRICED, per side. The rate card rows (migrations
 * 20260921–22) carry per-item charge-outs and a "Lineal Metres" unit, so a
 * customer-added line must ride qtyOverride (count, not metres) and the
 * item's own charge-out — otherwise the engine reads the side's length, or
 * $0 on the measureless extras block. `rateFor` below does that translation;
 * a code missing from the live card is OFFERED NOWHERE (never a silent $0).
 */
export const CATALOG_CODES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "Window Shutters", label: "Window shutters" },
  { code: "Side Gate", label: "Side gate" },
  { code: "Security Door", label: "Security door" },
  { code: "Meter Box", label: "Meter box" },
];

/** Sweep chips that price directly (Shed $640, Side gate $300 on the live
 * card). Carport stays an amber visit flag and Rear fence left the sweep —
 * both by Tom's ruling. */
export const SWEEP_PRICED_CODES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "Shed", label: "Shed" },
  { code: "Side Gate", label: "Side gate" },
];

/** Condition & access allowances — flat one-off lines on the extras block. */
export const ALLOWANCE_CODES = {
  rot: { code: "Minor Fascia Rot Allowance", label: "Minor fascia rot allowance" },
  access: { code: "Access Allowance", label: "Access allowance" },
} as const;

/** The condition modifier Tom ruled for "Weathered" — ×1.8 on labour hours. */
export const WEATHERED_MODIFIER_CODE = "EXT-WEATHERED";

type LooseRateItem = {
  code: string; category: string;
  rate_1_coat?: number | null; rate_2_coat?: number | null; rate_3_coat?: number | null;
  charge_out_cents?: number | null;
};

/** The live card's price for one of OUR per-item codes: 2-coat hours × the
 * item's own charge-out. Null when the card can't price it. */
export function rateFor(
  rateItems: ReadonlyArray<LooseRateItem>,
  code: string,
): { chargeOutDollars: number; priceCents: number } | null {
  const r = rateItems.find((x) => x.category === "Exterior" && x.code === code);
  if (!r || !r.rate_2_coat || !r.charge_out_cents) return null;
  return {
    chargeOutDollars: r.charge_out_cents / 100,
    priceCents: Math.round(r.rate_2_coat * r.charge_out_cents),
  };
}

/** Display prices for the add-panel + sweep chips, straight off the card. */
/**
 * Every rate code priced per item ("Hours Per Item"): posts, strapping,
 * shutters, meter boxes… Tom (5 Sep): the wizard showed Posts and Strapping
 * with no way to change the count — `countable` was a hand-kept whitelist
 * while the server accepted any count. Anything priced per item is countable.
 */
export function hoursPerItemCodes(rateItems: ReadonlyArray<LooseRateItem>): ReadonlySet<string> {
  return new Set(rateItems.filter((r) => String((r as { unit?: unknown }).unit ?? "") === "Hours Per Item").map((r) => String(r.code)));
}

export function extrasPrices(rateItems: ReadonlyArray<LooseRateItem>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { code } of [...CATALOG_CODES, ...SWEEP_PRICED_CODES]) {
    const r = rateFor(rateItems, code);
    if (r) out[code] = r.priceCents;
  }
  return out;
}

type LooseSurface = Record<string, unknown> & { id?: number; code?: string };
export type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; name?: string; type?: string; areaType?: string;
  L?: number; H?: number; isOption?: boolean;
  surfaces?: LooseSurface[];
  customer?: { include: boolean | null; size: "yes" | "adjusted" | "ns" | null; confirmed: boolean };
  customerCustom?: string[];
};

export type SidesLoopMeta = {
  extrasAns: "none" | "some" | null;
  cond: { cond: "good" | "weathered" | "peeling" | null; rot: "no" | "little" | "lots" | null; acc: "steep" | "tight" | "high" | "none" | null };
  dwOk: boolean | null;
  sweepAns: "none" | "added" | null;
  done: { extras: boolean; cond: boolean; dw: boolean; sweep: boolean };
};

export function defaultSidesLoop(): SidesLoopMeta {
  return {
    extrasAns: null,
    cond: { cond: null, rot: null, acc: null },
    dwOk: null,
    sweepAns: null,
    done: { extras: false, cond: false, dw: false, sweep: false },
  };
}

export function isSideBlock(b: LooseBlock): boolean {
  return b.kind === "area" && b.type === "Exterior" && b.areaType === "surface"
    && SIDE_KEYS.some((k) => SIDE_MATCH[k].test(String(b.name ?? "")));
}

export function findSide(blocks: LooseBlock[], key: SideKey): LooseBlock | null {
  return blocks.find((b) => b.kind === "area" && b.type === "Exterior" && b.areaType === "surface"
    && SIDE_MATCH[key].test(String(b.name ?? ""))) ?? null;
}

function customerOf(b: LooseBlock) {
  return b.customer ?? { include: null as boolean | null, size: null, confirmed: false };
}

export function isWallLine(s: LooseSurface): boolean {
  return WALL_CODES.some((w) => w.code === String(s.code ?? ""));
}
const isWindowLine = (s: LooseSurface) => substrateKeyForRateCode(String(s.code ?? "")) === "exterior_windows";
const isDoorLine = (s: LooseSurface) => substrateKeyForRateCode(String(s.code ?? "")) === "exterior_doors"
  || substrateKeyForRateCode(String(s.code ?? "")) === "garage_doors";

export function wallSumPct(b: LooseBlock): number {
  return (b.surfaces ?? []).filter(isWallLine).reduce((n, s) => n + (Number(s.sharePct) || 0), 0);
}

/** Re-derive every wall line's measures from the side's L×H and its share —
 * called after any dims or share change so pricing always reads the truth. */
function syncWallMeasures(b: LooseBlock): void {
  const L = Number(b.L) || 0;
  const H = Number(b.H) || 0;
  for (const s of b.surfaces ?? []) {
    if (!isWallLine(s)) continue;
    const pct = Number(s.sharePct) || 0;
    s.measureL = L > 0 ? Math.round(L * pct) / 100 : null; // L × pct/100
    s.measureH = H > 0 ? H : null;
  }
}

/** First-touch normalisation: a scaffolded side has one wall line with no
 * share — it means 100%. */
function normaliseShares(b: LooseBlock): void {
  const walls = (b.surfaces ?? []).filter(isWallLine);
  if (walls.length && walls.every((s) => s.sharePct == null)) {
    walls.forEach((s, i) => { s.sharePct = i === 0 ? 100 : 0; });
  }
  syncWallMeasures(b);
}

export type SidesResult = { ok: true; blocks: LooseBlock[] } | { ok: false; error: string };

function withSide(blocks: LooseBlock[], key: SideKey, fn: (b: LooseBlock) => string | void): SidesResult {
  const side = findSide(blocks, key);
  if (!side) return { ok: false, error: "No such side on this estimate." };
  const copy: LooseBlock = { ...side, surfaces: (side.surfaces ?? []).map((s) => ({ ...s })), customer: { ...customerOf(side) } };
  const err = fn(copy);
  if (err) return { ok: false, error: err };
  return { ok: true, blocks: blocks.map((b) => (b === side ? copy : b)) };
}

/** "Are we painting this side?" — No marks NOT PAINTING: an option area
 * (outside the total, an explicit exclusion on the quote) and immediately
 * confirmed in the loop. */
export function applySideInclude(blocks: LooseBlock[], key: SideKey, include: boolean): SidesResult {
  return withSide(blocks, key, (b) => {
    normaliseShares(b);
    b.customer = { ...customerOf(b), include, confirmed: !include };
    b.isOption = !include;
  });
}

/** The L×H answer. notSure widens the range (the deferral is the route's
 * job); real metres reprice walls and run items through the engine. */
export function applySideDims(
  blocks: LooseBlock[], key: SideKey,
  dims: { lengthM?: number | null; heightM?: number | null; notSure?: boolean },
): SidesResult {
  return withSide(blocks, key, (b) => {
    const c = customerOf(b);
    if (c.include !== true) return "Answer “Are we painting this side?” first.";
    if (dims.notSure) {
      b.customer = { ...c, size: "ns" };
      return;
    }
    const L = dims.lengthM ?? (Number(b.L) || 0);
    const H = dims.heightM ?? (Number(b.H) || 0);
    if (!(L > 0) || !(H > 0)) return "Length and height in metres, please — or “not sure”.";
    // Mockup behaviour: the gentle clamp (3–40 m long, 2–8 m high) — out of
    // range proceeds at the nearest bound, never a refusal.
    b.L = Math.min(40, Math.max(3, L));
    b.H = Math.min(8, Math.max(2, H));
    b.origin = "customer_stated"; b.confidence = 0.85;
    b.assumedFields = (Array.isArray(b.assumedFields) ? (b.assumedFields as string[]) : []).filter((f) => f !== "L" && f !== "H");
    b.customer = { ...c, size: "adjusted" };
    syncWallMeasures(b);
  });
}

/** "Looks right" on a side — R5: settles the dimensions the same way
 * applySideDims does, so agreeing with our figure lifts the confidence
 * score instead of leaving it pinned (see rooms-loop applyRoomSizeOk). */
export function applySideSizeOk(blocks: LooseBlock[], key: SideKey): SidesResult {
  return withSide(blocks, key, (b) => {
    const c = customerOf(b);
    if (c.include !== true) return "Answer “Are we painting this side?” first.";
    normaliseShares(b);
    b.origin = "customer_stated"; b.confidence = 0.85;
    // Only the DIMENSIONS the question asked about. `width_from_plan` and
    // `exterior_envelope` are staff-review provenance flags — a customer
    // saying "looks right" is not a staff measurement, so they stay put.
    b.assumedFields = (Array.isArray(b.assumedFields) ? (b.assumedFields as string[]) : [])
      .filter((f) => f !== "L" && f !== "H");
    b.customer = { ...c, size: "yes" };
  });
}

export function applyWallShare(blocks: LooseBlock[], key: SideKey, surfaceId: number, pct: number): SidesResult {
  if (![25, 50, 75, 100].includes(pct)) return { ok: false, error: "Shares are 25 / 50 / 75 / 100%." };
  return withSide(blocks, key, (b) => {
    normaliseShares(b);
    const line = (b.surfaces ?? []).find((s) => isWallLine(s) && Number(s.id) === surfaceId);
    if (!line) return "That wall surface isn't on this side.";
    line.sharePct = pct;
    syncWallMeasures(b);
  });
}

/** "+ Render — wall surface": arrives at 25% and AUTO-BALANCES — the largest
 * existing wall gives up the share so the side stays at 100%. */
export function addWallSurface(
  blocks: LooseBlock[], key: SideKey, code: string, nextId: () => number,
  defaultCoats: number | null = null,
): SidesResult {
  const def = WALL_CODES.find((w) => w.code === code);
  if (!def) return { ok: false, error: "That isn't a wall surface we price." };
  return withSide(blocks, key, (b) => {
    normaliseShares(b);
    const walls = (b.surfaces ?? []).filter(isWallLine);
    if (walls.some((s) => String(s.code) === code)) return "That wall surface is already on this side.";
    const line = makeDraftSurface(nextId(), def.code, def.label, 1, "customer_stated", 0.75, []) as unknown as LooseSurface;
    // The card's own coat count — unpainted brick is a 3-coat row.
    if (defaultCoats != null) line.coats = defaultCoats;
    line.sharePct = 25;
    const biggest = walls.sort((a, x) => (Number(x.sharePct) || 0) - (Number(a.sharePct) || 0))[0];
    if (biggest) biggest.sharePct = Math.max(0, (Number(biggest.sharePct) || 0) - 25);
    b.surfaces = [...(b.surfaces ?? []), line];
    syncWallMeasures(b);
  });
}

/**
 * R5: add ANY exterior rate-card row to one side (eaves, gutters, posts,
 * shutters, a roof…). The route validates the code against the live card
 * and passes the per-item charge-out where the row carries its own, so the
 * engine bills what the card says rather than the category rate.
 *
 * Quantity looks after itself: computeQuantity reads a lineal row off the
 * side's length and an M2 row off length × height, so only per-item rows
 * ride the count.
 */
/** Codes a side may carry twice (Tom, 5 Sep 2026): a double-storey house
 * has upper and lower eaves, each running the full length of the side. */
export const TWICE_OK_CODES: ReadonlySet<string> = new Set(["Eaves"]);
const SECOND_ROW_LABEL: Record<string, [string, string]> = { Eaves: ["Eaves (lower)", "Eaves (upper)"] };

export function addSideSurface(
  blocks: LooseBlock[], key: SideKey, code: string, label: string,
  nextId: () => number, chargeOutDollars: number | null = null,
): SidesResult {
  return withSide(blocks, key, (b) => {
    const existing = (b.surfaces ?? []).filter((s) => String(s.code) === code);
    if (existing.length >= 1 && !TWICE_OK_CODES.has(code)) return "That's already on this side.";
    if (existing.length >= 2) return "That's already on this side twice.";
    let lineLabel = label;
    if (existing.length === 1) {
      // A second row: name both so the sheet never reads "Eaves, Eaves".
      const [first, second] = SECOND_ROW_LABEL[code] ?? [`${label} (1)`, `${label} (2)`];
      existing[0].internalLabel = first;
      lineLabel = second;
    }
    const line = makeDraftSurface(nextId(), code, lineLabel, 1, "customer_stated", 0.75, []) as unknown as LooseSurface;
    if (chargeOutDollars != null) { line.useCustomRate = true; line.customRate = chargeOutDollars; }
    b.surfaces = [...(b.surfaces ?? []), line];
  });
}

/**
 * Take one line OFF a side (Tom, 21 Aug: "I can't untick items from exterior
 * quotes, all should be untickable").
 *
 * The interior editor has had `room_remove_line` since R5; the sides editor
 * rendered every tile as permanently ON with no way back — a customer who
 * wasn't having the gutters done had to ask for a person. Walls, the "also
 * on this side" tiles and the customer's own named customs are all removable
 * here.
 *
 * A wall is the one that needs care: shares must still add to 100, so the
 * removed share goes to the largest wall left. The LAST wall cannot go —
 * a side with no wall surface isn't a side you skip a surface on, it's a
 * side you skip, and "No — skip this side" already does that properly
 * (it stays visible on the quote as an exclusion).
 */
export function removeSideLine(blocks: LooseBlock[], key: SideKey, surfaceId: number): SidesResult {
  return withSide(blocks, key, (b) => {
    const surfaces = b.surfaces ?? [];
    const line = surfaces.find((s) => Number(s.id) === surfaceId);
    if (!line) return "That item isn't on this side.";
    if (isWallLine(line)) {
      normaliseShares(b);
      const walls = (b.surfaces ?? []).filter(isWallLine);
      if (walls.length <= 1) {
        return "A side needs at least one wall surface — use “No — skip this side” if none of it is being painted.";
      }
      const share = Number(line.sharePct) || 0;
      const biggest = walls.filter((s) => Number(s.id) !== surfaceId)
        .sort((a, x) => (Number(x.sharePct) || 0) - (Number(a.sharePct) || 0))[0];
      if (biggest) biggest.sharePct = Math.min(100, (Number(biggest.sharePct) || 0) + share);
    }
    b.surfaces = (b.surfaces ?? []).filter((s) => Number(s.id) !== surfaceId);
    syncWallMeasures(b);
  });
}

/** Take one of the customer's own named customs off a side. Customs are
 * never priced, but they DO route the job to a visit — so removing one has
 * to be possible, or a typo is a site visit. */
export function removeSideCustom(blocks: LooseBlock[], key: SideKey, index: number): SidesResult {
  return withSide(blocks, key, (b) => {
    const customs = b.customerCustom ?? [];
    if (!(index >= 0 && index < customs.length)) return "That note isn't on this side.";
    b.customerCustom = customs.filter((_, i) => i !== index);
  });
}

export function applyWindowSize(blocks: LooseBlock[], key: SideKey, surfaceId: number, size: "S" | "M" | "L"): SidesResult {
  return withSide(blocks, key, (b) => {
    const line = (b.surfaces ?? []).find((s) => isWindowLine(s) && Number(s.id) === surfaceId);
    if (!line) return "That window group isn't on this side.";
    line.sizeBand = size;
    const count = Number(line.count) || 1;
    line.qtyOverride = size === "M" ? null : Math.round(count * WINDOW_FACTOR[size] * 100) / 100;
  });
}

export function applySideCount(blocks: LooseBlock[], key: SideKey, surfaceId: number, count: number): SidesResult {
  if (!(count >= 1 && count <= 20)) return { ok: false, error: "Counts run 1–20." };
  return withSide(blocks, key, (b) => {
    const line = (b.surfaces ?? []).find((s) => Number(s.id) === surfaceId);
    if (!line) return "That item isn't on this side.";
    line.count = count;
    const size = (line.sizeBand as "S" | "M" | "L" | undefined) ?? "M";
    if (isWindowLine(line) && size !== "M") line.qtyOverride = Math.round(count * WINDOW_FACTOR[size] * 100) / 100;
    // Catalogue items are per-item priced on a lineal-unit card row —
    // qtyOverride IS the count (see pricedItemLine).
    if (isCatalogLine(line)) line.qtyOverride = count;
  });
}

/** "+ More windows — a different size": window GROUPS are first-class; a side
 * can hold 2 medium + 1 large as separate lines. */
export function addWindowGroup(blocks: LooseBlock[], key: SideKey, nextId: () => number): SidesResult {
  return withSide(blocks, key, (b) => {
    const line = makeDraftSurface(nextId(), "Fixed / Picture Window", "More windows", 1, "customer_stated", 0.75, []) as unknown as LooseSurface;
    line.sizeBand = "M";
    b.surfaces = [...(b.surfaces ?? []), line];
  });
}

/** A per-item priced line for our catalogue/sweep/allowance codes: count
 * rides qtyOverride (the card's unit is lineal) and the item's own
 * charge-out rides customRate, so the price lands exactly as ruled. */
function pricedItemLine(id: number, code: string, label: string, chargeOutDollars: number): LooseSurface {
  const line = makeDraftSurface(id, code, label, 1, "customer_stated", 0.9, []) as unknown as LooseSurface;
  line.qtyOverride = 1;
  line.useCustomRate = true;
  line.customRate = chargeOutDollars;
  return line;
}

export const isCatalogLine = (s: LooseSurface) => CATALOG_CODES.some((c) => c.code === String(s.code ?? ""));

/** "+ Security door — $345": a priced catalogue item onto THIS side's tile
 * grid, steppable like any counted item. */
export function addCatalogItem(
  blocks: LooseBlock[], key: SideKey, code: string,
  nextId: () => number, chargeOutDollars: number,
): SidesResult {
  const def = CATALOG_CODES.find((c) => c.code === code);
  if (!def) return { ok: false, error: "That isn't a catalogue item we price." };
  return withSide(blocks, key, (b) => {
    if ((b.surfaces ?? []).some((s) => String(s.code) === code)) {
      return "That's already on this side — use its − / + to change how many.";
    }
    b.surfaces = [...(b.surfaces ?? []), pricedItemLine(nextId(), def.code, def.label, chargeOutDollars)];
  });
}

const EXTRAS_BLOCK = /Exterior - Extras/i;

export function hasExtrasItem(blocks: LooseBlock[], code: string): boolean {
  const b = blocks.find((x) => x.kind === "area" && EXTRAS_BLOCK.test(String(x.name ?? "")));
  return (b?.surfaces ?? []).some((s) => String(s.code) === code);
}

/** Put a priced whole-job item on (or take it off) the "Exterior - Extras"
 * block — sweep sheds/gates and the condition/access allowances live here.
 * Creates the block on first use; idempotent both ways. */
export function toggleExtrasItem(
  blocks: LooseBlock[], code: string, label: string, on: boolean,
  nextId: () => number, chargeOutDollars: number,
): SidesResult {
  const existing = blocks.find((x) => x.kind === "area" && EXTRAS_BLOCK.test(String(x.name ?? "")));
  if (!on) {
    if (!existing || !(existing.surfaces ?? []).some((s) => String(s.code) === code)) return { ok: true, blocks };
    const copy = { ...existing, surfaces: (existing.surfaces ?? []).filter((s) => String(s.code) !== code) };
    return { ok: true, blocks: blocks.map((b) => (b === existing ? copy : b)) };
  }
  if (existing && (existing.surfaces ?? []).some((s) => String(s.code) === code)) return { ok: true, blocks };
  const line = pricedItemLine(nextId(), code, label, chargeOutDollars);
  if (existing) {
    const copy = { ...existing, surfaces: [...(existing.surfaces ?? []), line] };
    return { ok: true, blocks: blocks.map((b) => (b === existing ? copy : b)) };
  }
  const area: LooseBlock = {
    id: nextId(), kind: "area", name: "Exterior - Extras", type: "Exterior", areaType: "surface",
    roomType: "exterior", storey: "ground",
    L: 0, W: 0, H: 0,
    isOption: false, description: "", open: false, media: [],
    origin: "customer_stated", confidence: 0.9,
    assumedFields: [], extractionSourceId: null,
    surfaces: [line],
  } as LooseBlock;
  return { ok: true, blocks: [...blocks, area] };
}

/** A named custom surface: recorded and flagged — NEVER auto-priced. The
 * route adds the amber deferral; the estimate routes to the visit tier. */
export function addSideCustom(blocks: LooseBlock[], key: SideKey, name: string): SidesResult {
  return withSide(blocks, key, (b) => {
    b.customerCustom = [...(b.customerCustom ?? []), name.trim().slice(0, 120)];
  });
}

/** Doors/windows totals across the sides being painted — the check card. */
export function dwTotals(blocks: LooseBlock[]): { windows: number; doors: number } {
  let windows = 0; let doors = 0;
  for (const key of SIDE_KEYS) {
    const b = findSide(blocks, key);
    if (!b || b.customer?.include === false) continue;
    for (const s of b.surfaces ?? []) {
      if (isWindowLine(s)) windows += Number(s.count) || 1;
      if (isDoorLine(s)) doors += Number(s.count) || 1;
    }
  }
  return { windows, doors };
}

/** Confirm one side — the loop's gate. Unanswered required questions refuse
 * by name. Wall shares may total UNDER 100% (Tom, 31 Aug: a wall that's
 * mostly glass or garage door is painted at 25–75%, and that must save) —
 * only an over-committed mix (>100%) or an all-zero one refuses. */
export function confirmSide(blocks: LooseBlock[], key: SideKey): SidesResult {
  return withSide(blocks, key, (b) => {
    const c = customerOf(b);
    // The required questions are DATA shared with the assistant's question
    // graph (lib/wizard/required-questions.ts) — one list, two consumers.
    const err = sideGateError({ customer: c }, { hasWalls: (b.surfaces ?? []).some(isWallLine), wallSumPct: wallSumPct(b) });
    if (err) return err;
    b.customer = { ...c, confirmed: true };
  });
}

/** Why this job is on the visit tier — the mockup names the reason on the
 * sticky tier line, in this priority order. "big" is the residual: nothing
 * specific flagged it, the exterior is just past the self-serve bar. */
export type VisitReason = "custom" | "peeling" | "rot" | "flagged" | "big" | "signoff";

export function visitReason(
  meta: SidesLoopMeta,
  deferred: ReadonlyArray<{ what: string; needs: string; kind?: string }>,
): VisitReason {
  if (deferred.some((d) => d.kind === "custom_surface")) return "custom";
  if (meta.cond.cond === "peeling") return "peeling";
  if (meta.cond.rot === "lots") return "rot";
  if (deferred.some((d) => /flagged/i.test(`${d.what} ${d.needs}`))) return "flagged";
  // The floor, since 21 Aug: every exterior job is signed off by an
  // estimator, so "big" is no longer the reason of last resort.
  return "signoff";
}

export function sidesDoneCount(blocks: LooseBlock[], meta: SidesLoopMeta): { done: number; total: number; allDone: boolean } {
  let done = 0;
  for (const key of SIDE_KEYS) {
    const b = findSide(blocks, key);
    if (b?.customer?.confirmed) done++;
  }
  done += Number(meta.done.extras) + Number(meta.done.cond) + Number(meta.done.dw) + Number(meta.done.sweep);
  return { done, total: 8, allDone: done === 8 };
}

// ---- the view ---------------------------------------------------------------

export type SideView = {
  key: SideKey;
  label: string;
  include: boolean | null;
  size: "yes" | "adjusted" | "ns" | null;
  confirmed: boolean;
  L: number; H: number;
  walls: Array<{ id: number; code: string; label: string; pct: number }>;
  wallSum: number;
  tiles: Array<{ id: number; code: string; label: string; count: number; countable: boolean; window: boolean; sizeBand: "S" | "M" | "L" | null }>;
  customs: string[];
};

export type SidesView = {
  sides: SideView[];
  /** C1: the visual panel's geometry chips — read from the ANSWERS. */
  geo: { storeys: "single" | "double" | null; substrates: string[] };
  dw: { windows: number; doors: number; ok: boolean | null };
  meta: SidesLoopMeta;
  progress: { done: number; total: number; allDone: boolean };
  /** Priced add-panel chips — only codes the live card can price. */
  catalog: Array<{ code: string; label: string; priceCents: number }>;
  /** Priced sweep chips with their on-state (Shed / Side gate). */
  sweepItems: Array<{ code: string; label: string; priceCents: number; on: boolean }>;
  /** R5: every exterior surface the live card can price, offered per side. */
  addable: Array<{ key: string; label: string; group: string }>;
  /** The wall substrates the live card can price — the add panel's wall chips. */
  wallOptions: Array<{ code: string; label: string }>;
};

export function sidesView(
  blocks: LooseBlock[], meta: SidesLoopMeta,
  prices: Record<string, number> = {},
  storeys: "single" | "double" | null = null,
  addable: Array<{ key: string; label: string; group: string }> = [],
  wallOptions: Array<{ code: string; label: string }> = WALL_CODES.map((w) => ({ ...w })),
  /** Rate codes priced per item — every one of them gets a − / + stepper. */
  countableCodes: ReadonlySet<string> = new Set(),
): SidesView | null {
  if (!SIDE_KEYS.some((k) => findSide(blocks, k))) return null;
  const sides: SideView[] = [];
  for (const key of SIDE_KEYS) {
    const b = findSide(blocks, key);
    if (!b) continue;
    const c = customerOf(b);
    const surfaces = b.surfaces ?? [];
    const wallsRaw = surfaces.filter(isWallLine);
    const defaulted = wallsRaw.length > 0 && wallsRaw.every((s) => s.sharePct == null);
    sides.push({
      key,
      label: SIDE_LABEL[key],
      include: c.include,
      size: c.size,
      confirmed: c.confirmed,
      L: Number(b.L) || 0,
      H: Number(b.H) || 0,
      walls: wallsRaw.map((s, i) => ({
        id: Number(s.id) || 0,
        code: String(s.code ?? ""),
        label: WALL_CODES.find((w) => w.code === String(s.code))?.label ?? String(s.code),
        pct: s.sharePct == null ? (defaulted && i === 0 ? 100 : 0) : Number(s.sharePct),
      })),
      wallSum: defaulted ? 100 : wallSumPct(b),
      tiles: surfaces.filter((s) => !isWallLine(s)).map((s) => ({
        id: Number(s.id) || 0,
        code: String(s.code ?? ""),
        // Mockup parity: window lines read "Windows" customer-facing, never
        // the rate code ("Fixed / Picture Window"); added groups keep theirs.
        label: isWindowLine(s) && String(s.internalLabel ?? "") === String(s.code ?? "")
          ? "Windows"
          : String(s.internalLabel ?? s.code ?? ""),
        count: Number(s.count) || 1,
        countable: isWindowLine(s) || isDoorLine(s) || isCatalogLine(s)
          || substrateKeyForRateCode(String(s.code ?? "")) === "downpipes"
          || countableCodes.has(String(s.code ?? "")),
        window: isWindowLine(s),
        sizeBand: (s.sizeBand as "S" | "M" | "L" | undefined) ?? (isWindowLine(s) ? "M" : null),
      })),
      customs: b.customerCustom ?? [],
    });
  }
  const substrates = [...new Set(sides.flatMap((sv) => sv.walls.map((w) => w.label)))];
  return {
    sides,
    geo: { storeys, substrates },
    dw: { ...dwTotals(blocks), ok: meta.dwOk },
    meta,
    progress: sidesDoneCount(blocks, meta),
    catalog: CATALOG_CODES.filter((c) => prices[c.code] != null)
      .map((c) => ({ ...c, priceCents: prices[c.code] })),
    sweepItems: SWEEP_PRICED_CODES.filter((c) => prices[c.code] != null)
      .map((c) => ({ ...c, priceCents: prices[c.code], on: hasExtrasItem(blocks, c.code) })),
    addable,
    wallOptions,
  };
}
