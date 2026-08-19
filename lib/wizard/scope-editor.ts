import { makeDraftSurface, type DraftArea } from "@/lib/extract/draft";
import { substrateKeyForRateCode, substrateLabel, type SubstrateKey } from "@/lib/estimate/substrates";
import { SURFACE_TO_RATE_CODE, doorRateCode, windowRateCode, type ScopeRule } from "@/lib/extract/scope";
import type { WizardState } from "./state";

/**
 * Part B: the customer scope editor's server logic. Pure functions over the
 * area tree — the route applies them and reprices via lib/pricing.
 *
 * THE RULE (workflow doc / brief): customers control WHAT is painted, never
 * hours, rates, prep or allowances. The only mutations this module can
 * express are: substrate on/off, countable quantity, room rename. Everything
 * else a customer sends is rejected by the route's schema before it gets
 * here. Prep never renders as hours customer-side — it is words ("includes
 * filling minor cracks and sanding").
 */

export type CustomerTile = {
  key: SubstrateKey | string;
  label: string;
  on: boolean;
  /** Present only on countable tiles (doors, windows, robe doors…). */
  count?: number;
  countable: boolean;
  /** Offered under "More surfaces…" rather than the main grid. */
  longTail: boolean;
  /** R1.2: priced at the default rate because the style is unanswered —
   * renders as an amber "style to confirm" trace, never a silent $0. */
  styleToConfirm?: boolean;
};

export type CustomerScopeRoom = {
  areaId: number;
  name: string;
  m2: number | null;
  tiles: CustomerTile[];
};

type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; name?: string; type?: string; roomType?: string;
  L?: number; W?: number;
  surfaces?: Array<Record<string, unknown>>;
};

/** The substrate key a scope-rule row's tile governs. */
function keyForRule(rule: ScopeRule): SubstrateKey | string | null {
  const code = SURFACE_TO_RATE_CODE[rule.surface_type] ?? rule.surface_type;
  // Door & Frame / Windows expand to style codes — their tick is the family.
  if (rule.surface_type === "Door & Frame") return "doors";
  if (rule.surface_type === "Windows") return "windows";
  return substrateKeyForRateCode(code) ?? rule.surface_type;
}

const COUNTABLE_KEYS = new Set(["doors", "windows"]);

/**
 * The tile list a customer sees for one room: derived from the SAME scope
 * rules that drive capture's tile grid (room_type_scope_rules ordering), with
 * tick state read off the room's actual surfaces. Rules the wizard pre-ticked
 * sit in the grid; optional rules ride the "More surfaces…" tail.
 */
export function customerRoomView(block: LooseBlock, rules: ScopeRule[]): CustomerScopeRoom {
  const roomType = typeof block.roomType === "string" ? block.roomType : "bedroom";
  const surfaces = Array.isArray(block.surfaces) ? block.surfaces : [];

  const stateFor = (key: string) => {
    let on = false;
    let count = 0;
    let styleToConfirm = false;
    for (const s of surfaces) {
      const k = substrateKeyForRateCode(String(s.code ?? ""));
      if (k === key) {
        on = true;
        count += Number(s.count) || 1;
        // ai_assumed + assumed style = priced at the default rate (R1.2).
        const assumed = Array.isArray(s.assumedFields) ? (s.assumedFields as string[]) : [];
        if (s.origin === "ai_assumed" && assumed.includes("style")) styleToConfirm = true;
      }
    }
    return { on, count: Math.max(1, count), styleToConfirm };
  };

  const seen = new Set<string>();
  const tiles: CustomerTile[] = [];
  for (const rule of rules.filter((r) => r.room_type === roomType)) {
    const key = keyForRule(rule);
    if (!key || seen.has(String(key))) continue;
    seen.add(String(key));
    const st = stateFor(String(key));
    const countable = COUNTABLE_KEYS.has(String(key));
    tiles.push({
      key,
      label: typeof key === "string" && substrateKeyForRateCode(SURFACE_TO_RATE_CODE[rule.surface_type] ?? "")
        ? substrateLabel(key as SubstrateKey)
        : rule.surface_type === "Door & Frame" ? "Doors"
        : rule.surface_type,
      on: st.on,
      ...(countable ? { count: st.count } : {}),
      ...(st.styleToConfirm ? { styleToConfirm: true } : {}),
      countable,
      // A rule marked optional (is_option) — or currently off — is long-tail
      // only when the wizard didn't put it on the job.
      longTail: (rule as { is_option?: boolean }).is_option === true && !st.on,
    });
  }
  return {
    areaId: Number(block.id),
    name: String(block.name ?? "Room"),
    m2: Number(block.L) > 0 && Number(block.W) > 0
      ? Math.round(Number(block.L) * Number(block.W) * 10) / 10
      : null,
    tiles,
  };
}

export function customerScopeRooms(blocks: LooseBlock[], rules: ScopeRule[]): CustomerScopeRoom[] {
  return blocks
    .filter((b) => b.kind === "area" && b.type !== "Exterior")
    .map((b) => customerRoomView(b, rules));
}

/** The rate code a customer's ON-toggle adds for a substrate key, using the
 * wizard's own answers for styled openings (never a guess presented as
 * settled — styled adds carry assumedFields ["style"]). */
export function rateCodeForCustomerAdd(
  key: string,
  snapshot: WizardState | null,
): { code: string; label: string; assumed: string[] } | null {
  if (key === "doors") {
    const style = snapshot?.details.doorStyle;
    const code = style && style !== "unsure" ? doorRateCode(style) : "Flat Door and Frame (1 Side)";
    return { code: code ?? "Flat Door and Frame (1 Side)", label: "Doors", assumed: ["style"] };
  }
  if (key === "windows") {
    const style = snapshot?.details.windowStyle;
    const schema = style === "casement" ? "awning_casement"
      : style === "sash" ? "double_hung_sash"
      : style === "colonial" ? "colonial_bay"
      : style === "winder" ? "awning_casement" : null;
    const code = schema ? windowRateCode(schema) : null;
    return { code: code ?? "Awning / Casement Window", label: "Windows", assumed: ["style"] };
  }
  // One-to-one substrates: the registry's first code for the key.
  const direct: Record<string, string> = {
    walls: "Walls", ceilings: "Ceilings", cornices: "Standard Cornices",
    skirting: "Skirting Boards", architraves: "Architrave (1 Side)",
  };
  const code = direct[key];
  return code ? { code, label: substrateLabel(key as SubstrateKey), assumed: [] } : null;
}

export type ScopeToggleResult =
  | { ok: true; blocks: LooseBlock[] }
  | { ok: false; error: string };

/** Substrate on/off for one room. OFF removes that substrate's lines; ON adds
 * one line at the wizard-answered style, origin customer_stated. */
export function applyToggle(
  blocks: LooseBlock[],
  areaId: number,
  key: string,
  on: boolean,
  snapshot: WizardState | null,
  nextId: () => number,
): ScopeToggleResult {
  const idx = blocks.findIndex((b) => b.kind === "area" && Number(b.id) === areaId);
  if (idx < 0) return { ok: false, error: "No such room." };
  const block = { ...blocks[idx] };
  const surfaces = Array.isArray(block.surfaces) ? [...block.surfaces] : [];

  if (!on) {
    const kept = surfaces.filter((s) => substrateKeyForRateCode(String(s.code ?? "")) !== key);
    if (kept.length === surfaces.length) return { ok: false, error: "That surface isn't on this room." };
    block.surfaces = kept;
  } else {
    if (surfaces.some((s) => substrateKeyForRateCode(String(s.code ?? "")) === key)) {
      return { ok: false, error: "That surface is already on." };
    }
    const add = rateCodeForCustomerAdd(key, snapshot);
    if (!add) return { ok: false, error: "That surface can't be added here." };
    const line = makeDraftSurface(nextId(), add.code, add.label, 1, "customer_stated", 0.75, add.assumed);
    block.surfaces = [...surfaces, line as unknown as Record<string, unknown>];
  }
  const out = [...blocks];
  out[idx] = block;
  return { ok: true, blocks: out };
}

/** Quantity on a countable substrate (doors/windows), bounded 1–12. The
 * count lands on the room's FIRST line of that family; style variants keep
 * their own counts and the family total is what the customer sees. */
export function applyCount(
  blocks: LooseBlock[],
  areaId: number,
  key: string,
  count: number,
): ScopeToggleResult {
  if (!COUNTABLE_KEYS.has(key)) return { ok: false, error: "That surface has no count." };
  if (!(count >= 1 && count <= 12)) return { ok: false, error: "Count must be 1–12." };
  const idx = blocks.findIndex((b) => b.kind === "area" && Number(b.id) === areaId);
  if (idx < 0) return { ok: false, error: "No such room." };
  const block = { ...blocks[idx] };
  const surfaces = Array.isArray(block.surfaces) ? [...block.surfaces] : [];
  const mine = surfaces
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => substrateKeyForRateCode(String(s.code ?? "")) === key);
  if (mine.length === 0) return { ok: false, error: "Turn the surface on first." };
  // One family line: the whole count goes there. Mixed styles: adjust the
  // first line so the family total matches.
  const others = mine.slice(1).reduce((n, { s }) => n + (Number(s.count) || 1), 0);
  const first = { ...mine[0].s, count: Math.max(1, count - others) };
  surfaces[mine[0].i] = first;
  block.surfaces = surfaces;
  const out = [...blocks];
  out[idx] = block;
  return { ok: true, blocks: out };
}

export function applyRename(blocks: LooseBlock[], areaId: number, name: string): ScopeToggleResult {
  const idx = blocks.findIndex((b) => b.kind === "area" && Number(b.id) === areaId);
  if (idx < 0) return { ok: false, error: "No such room." };
  const clean = name.trim().slice(0, 60);
  if (!clean) return { ok: false, error: "A room needs a name." };
  const out = [...blocks];
  out[idx] = { ...blocks[idx], name: clean };
  return { ok: true, blocks: out };
}

// ---------------------------------------------------------------------------
// Part B2: the exterior — element-first, against the whole envelope
// ---------------------------------------------------------------------------

export type ExteriorExtent = "whole" | "front" | "front_sides";

export type ExteriorGroup = {
  group: "body" | "trims" | "roofline" | "extras";
  label: string;
  tiles: CustomerTile[];
};

export type CustomerExteriorView = {
  groups: ExteriorGroup[];
  extent: ExteriorExtent;
  /** Read-only geometry chips ("Not right? Tell us" flags the job). */
  storeys: number;
  fenceLengthM: number | null;
};

const EXT_GROUPS: Array<{ group: ExteriorGroup["group"]; label: string; keys: string[] }> = [
  { group: "body", label: "THE BODY", keys: ["weatherboards", "render", "brick"] },
  { group: "trims", label: "TRIMS & OPENINGS", keys: ["exterior_windows", "exterior_doors", "garage_doors"] },
  { group: "roofline", label: "THE ROOFLINE", keys: ["fascias", "gutters", "eaves", "downpipes"] },
  { group: "extras", label: "EXTRAS", keys: ["deck", "fence", "pergola", "balustrade"] },
];

const EXT_COUNTABLE = new Set(["exterior_windows", "exterior_doors", "garage_doors"]);

const isExtArea = (b: LooseBlock) => b.kind === "area" && b.type === "Exterior";
const elevationNameOf = (b: LooseBlock) => String(b.name ?? "").replace(/^Exterior\s*[-–]\s*/i, "").toLowerCase();

/** Which elevations an extent keeps IN the total (others park as options). */
export function elevationsKeptBy(extent: ExteriorExtent): (name: string) => boolean {
  if (extent === "whole") return () => true;
  if (extent === "front") return (n) => n === "front" || n === "extras";
  return (n) => n !== "rear"; // front + sides
}

export function customerExteriorView(blocks: LooseBlock[]): CustomerExteriorView | null {
  const ext = blocks.filter(isExtArea);
  if (ext.length === 0) return null;

  const stateFor = (key: string) => {
    let on = false;
    let count = 0;
    let fenceLen: number | null = null;
    for (const b of ext) {
      for (const s of (b.surfaces ?? [])) {
        if (substrateKeyForRateCode(String(s.code ?? "")) !== key) continue;
        on = true;
        count += Number(s.count) || 1;
        if (key === "fence" && s.measureL != null) fenceLen = Number(s.measureL);
      }
    }
    return { on, count: Math.max(1, count), fenceLen };
  };

  // Extent reads off which elevations are parked as options.
  const optioned = new Set(ext.filter((b) => b.isOption === true).map(elevationNameOf));
  const extent: ExteriorExtent =
    optioned.size === 0 ? "whole"
    : optioned.has("left") || optioned.has("right") ? "front"
    : "front_sides";

  let fenceLengthM: number | null = null;
  const groups: ExteriorGroup[] = EXT_GROUPS.map((g) => ({
    group: g.group,
    label: g.label,
    tiles: g.keys.flatMap((key) => {
      const st = stateFor(key);
      if (key === "fence") fenceLengthM = st.fenceLen;
      // Body claddings the job doesn't have are noise, not choices.
      if (g.group === "body" && !st.on) return [];
      const countable = EXT_COUNTABLE.has(key);
      return [{
        key,
        label: substrateLabel(key as SubstrateKey),
        on: st.on,
        ...(countable ? { count: st.count } : {}),
        countable,
        longTail: false,
      }];
    }),
  })).filter((g) => g.tiles.length > 0 || g.group === "extras");

  const storeys = new Set(blocks.filter((b) => b.kind === "area" && b.type !== "Exterior")
    .map((b) => String(b.storey ?? "ground"))).size;

  return { groups, extent, storeys: Math.max(1, storeys), fenceLengthM };
}

/** Exterior on/off applies across EVERY elevation at once — gutters off means
 * gutters off, not gutters-off-on-the-front. ON restores via the substrate's
 * first rate code as a $0 measure-on-site line when nothing existed. */
export function applyExteriorToggle(
  blocks: LooseBlock[],
  key: string,
  on: boolean,
  nextId: () => number,
): ScopeToggleResult {
  const extIdx = blocks.map((b, i) => ({ b, i })).filter(({ b }) => isExtArea(b));
  if (extIdx.length === 0) return { ok: false, error: "This estimate has no exterior." };
  const out = [...blocks];

  if (!on) {
    let removed = 0;
    for (const { b, i } of extIdx) {
      const surfaces = (b.surfaces ?? []).filter((s) => {
        const match = substrateKeyForRateCode(String(s.code ?? "")) === key;
        if (match) removed++;
        return !match;
      });
      out[i] = { ...b, surfaces };
    }
    if (removed === 0) return { ok: false, error: "That surface isn't on this job." };
    return { ok: true, blocks: out };
  }

  const already = extIdx.some(({ b }) => (b.surfaces ?? []).some((s) => substrateKeyForRateCode(String(s.code ?? "")) === key));
  if (already) return { ok: false, error: "That surface is already on." };
  const CODE: Record<string, string> = {
    weatherboards: "Weatherboards", render: "Render", brick: "Brick",
    fascias: "Fascias", gutters: "Gutters", eaves: "Eaves", downpipes: "Downpipes",
    exterior_windows: "Fixed / Picture Window", exterior_doors: "Front Door",
    garage_doors: "Garage Door (1 Car)", deck: "Deck Painting", fence: "Paling Fence",
    pergola: "Pergola", balustrade: "Hand Rails",
  };
  const code = CODE[key];
  if (!code) return { ok: false, error: "That surface can't be added here." };
  // Extras land once (measured on site); per-elevation trims land on each
  // in-scope elevation so the estimator fills real numbers per side.
  const isExtra = ["deck", "fence", "pergola", "balustrade", "garage_doors"].includes(key);
  const targets = isExtra ? [extIdx[0]] : extIdx.filter(({ b }) => b.isOption !== true);
  for (const { b, i } of targets) {
    const line = makeDraftSurface(nextId(), code, substrateLabel(key as SubstrateKey), 1, "customer_stated", 0.75, ["exterior_envelope"]);
    out[i] = { ...out[i], surfaces: [...(out[i].surfaces ?? []), line as unknown as Record<string, unknown>] };
  }
  return { ok: true, blocks: out };
}

/** Whole house / Front only / Front + sides — parks out-of-scope elevations
 * as options (outside the total, nothing deleted, fully reversible). */
export function applyExtent(blocks: LooseBlock[], extent: ExteriorExtent): ScopeToggleResult {
  const keep = elevationsKeptBy(extent);
  let touched = false;
  const out = blocks.map((b) => {
    if (!isExtArea(b)) return b;
    touched = true;
    return { ...b, isOption: !keep(elevationNameOf(b)) };
  });
  if (!touched) return { ok: false, error: "This estimate has no exterior." };
  return { ok: true, blocks: out };
}

/** The fence takes metres (a scope quantity the brief explicitly grants) —
 * or "not sure", which the route records as an amber note instead. */
export function applyFenceLength(blocks: LooseBlock[], metres: number): ScopeToggleResult {
  if (!(metres > 0 && metres <= 500)) return { ok: false, error: "Fence length must be 1–500 m." };
  const out = [...blocks];
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (!isExtArea(b)) continue;
    const surfaces = [...(b.surfaces ?? [])];
    for (let j = 0; j < surfaces.length; j++) {
      if (substrateKeyForRateCode(String(surfaces[j].code ?? "")) === "fence") {
        surfaces[j] = { ...surfaces[j], measureL: metres };
        out[i] = { ...b, surfaces };
        return { ok: true, blocks: out };
      }
    }
  }
  return { ok: false, error: "Turn the fence on first." };
}

/** The visit slots offered — next three weekdays 9:00/14:00 unless Settings
 * scope_editor.visitSlots overrides. Server recomputes per request so
 * book_visit validates the slot came from us, never from the client. */
export function offeredVisitSlots(flags: { visitSlots?: string[] }): string[] {
  if (Array.isArray(flags.visitSlots) && flags.visitSlots.length) return flags.visitSlots.slice(0, 8);
  const out: string[] = [];
  const d = new Date();
  while (out.length < 6) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const day = d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
    out.push(`${day} · 9:00 am`, `${day} · 2:00 pm`);
  }
  return out.slice(0, 6);
}
