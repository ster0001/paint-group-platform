/**
 * The ONE substrate registry (A2). Every customer/staff-facing "what's being
 * painted" list — wizard page 2, the builder's grouped picker, capture's tile
 * grid and the coming customer scope editor — derives from this file plus the
 * live rate card. Nothing renders a hardcoded surface list.
 *
 * A substrate is a customer-meaning group over rate_items codes ("Doors"
 * spans the flat and panel door rates). Which SIDE a substrate belongs to —
 * Interior or Exterior — is not stated here: it is read from
 * rate_items.category at load time (substrateOptionsFromRates), so the rate
 * card stays the single authority on the interior/exterior split. A substrate
 * whose codes match no loaded rate item is not offered (e.g. Brick before the
 * 20260919 migration adds its rate) — a tick that cannot price is a lie.
 */

export const SUBSTRATE_DEFS = [
  // ---- interior (side confirmed against rate_items.category at load) ------
  { key: "walls", label: "Walls", codes: ["Walls"], defaultOn: true },
  { key: "ceilings", label: "Ceilings", codes: ["Ceilings"], defaultOn: true },
  { key: "cornices", label: "Cornices", codes: ["Standard Cornices", "Patterned Cornices"], defaultOn: true },
  {
    key: "doors", label: "Doors",
    codes: ["Flat Door and Frame (1 Side)", "4-6 Panel Door and Frame (1 Side)", "Flat Door (1 Side)", "4-6 Panel Door (1 Side)"],
    defaultOn: true,
  },
  { key: "architraves", label: "Architraves", codes: ["Architrave (1 Side)"], defaultOn: true },
  { key: "skirting", label: "Skirting boards", codes: ["Skirting Boards", "Skirting Boards MDF"], defaultOn: true },
  {
    key: "windows", label: "Windows",
    codes: ["Fixed / Picture / Window Reveal", "Awning / Casement Window", "Double Hung Sash", "Colonial / Bay Window"],
    defaultOn: false,
  },
  /** No per-room rate exists — merge.ts raises a whole-job deferral instead.
   * Offered whenever the rate card has any interior rates at all. */
  { key: "staircase", label: "Staircase", codes: [], defaultOn: false, alwaysOffer: "interior" },

  // ---- exterior -----------------------------------------------------------
  { key: "weatherboards", label: "Weatherboards", codes: ["Weatherboards"], defaultOn: true },
  { key: "render", label: "Render", codes: ["Render", "Stucco"], defaultOn: true },
  { key: "brick", label: "Brick (painted)", codes: ["Brick"], defaultOn: true },
  /** Bare brick that has never been painted: sealer plus two topcoats, which
   * is why its rate row carries default_coats 3 (migration 20260925). Not
   * pre-ticked — the customer has to say the brick is bare. */
  { key: "brick_unpainted", label: "Brick (unpainted — 3 coats)", codes: ["Brick (Unpainted)"], defaultOn: false },
  { key: "eaves", label: "Eaves", codes: ["Eaves"], defaultOn: true },
  { key: "fascias", label: "Fascias", codes: ["Fascias"], defaultOn: true },
  { key: "gutters", label: "Gutters", codes: ["Gutters"], defaultOn: true },
  { key: "downpipes", label: "Downpipes", codes: ["Downpipes"], defaultOn: true },
  { key: "exterior_windows", label: "Windows", codes: ["Fixed / Picture Window"], defaultOn: true },
  { key: "exterior_doors", label: "Doors", codes: ["Front Door", "Standard Door (1 Side)"], defaultOn: true },
  { key: "garage_doors", label: "Garage doors", codes: ["Garage Door (1 Car)", "Garage Door (2 Car)"], defaultOn: false },
  { key: "deck", label: "Deck", codes: ["Deck Painting"], defaultOn: false },
  { key: "fence", label: "Fence", codes: ["Paling Fence", "Picket Fence (Hand Paint)", "Picket Fence (Spray)"], defaultOn: false },
  { key: "pergola", label: "Pergola", codes: ["Pergola"], defaultOn: false },
  /**
   * BOTH sides (Tom, 23 Aug: "no option for balustrades"). The card files the
   * interior run under `Balustrades` and the exterior one under `Hand Rails`,
   * so a tick that only knew the exterior code was invisible indoors and went
   * by a name nobody searches for outdoors. One tick, one name, the right rate
   * row on each side.
   */
  { key: "balustrade", label: "Balustrades & hand rails", codes: ["Balustrades", "Hand Rails"], defaultOn: false },
] as const;

export type SubstrateKey = (typeof SUBSTRATE_DEFS)[number]["key"];
export const SUBSTRATE_KEYS = SUBSTRATE_DEFS.map((d) => d.key) as [SubstrateKey, ...SubstrateKey[]];

export type SubstrateSide = "interior" | "exterior";

/** What a page needs to render one tick — no rates ride along. */
export type SubstrateOption = { key: SubstrateKey; label: string; defaultOn: boolean };
export type SubstrateGroups = { interior: SubstrateOption[]; exterior: SubstrateOption[] };

const codeToKey = new Map<string, SubstrateKey>();
for (const def of SUBSTRATE_DEFS) for (const code of def.codes) codeToKey.set(code, def.key);

/** Which tick governs a rate code. Null = no tick touches it. */
export function substrateKeyForRateCode(code: string): SubstrateKey | null {
  return codeToKey.get(code) ?? null;
}

export function substrateLabel(key: SubstrateKey): string {
  return SUBSTRATE_DEFS.find((d) => d.key === key)?.label ?? key;
}

type RateItemLike = { code: string | null; category: string | null };

/**
 * The substrate lists a page may offer, derived from the loaded rate card:
 * a substrate appears on the side (Interior/Exterior) its matching rate
 * items declare, in registry order. Load rate_items server-side and pass the
 * result to the client — the options carry names only, never rates.
 */
export function substrateOptionsFromRates(rateItems: ReadonlyArray<RateItemLike>): SubstrateGroups {
  const sideByCode = new Map<string, SubstrateSide>();
  for (const r of rateItems) {
    if (!r.code) continue;
    const cat = (r.category ?? "").trim().toLowerCase();
    if (cat === "interior" || cat === "exterior") sideByCode.set(r.code, cat);
  }
  const groups: SubstrateGroups = { interior: [], exterior: [] };
  for (const def of SUBSTRATE_DEFS) {
    const sides = new Set(def.codes.map((c) => sideByCode.get(c)).filter((s): s is SubstrateSide => s != null));
    if ("alwaysOffer" in def && sides.size === 0 && groups[def.alwaysOffer as SubstrateSide] !== undefined) {
      // Special substrates with no rate rows (staircase) ride with their side
      // as long as that side has rates at all.
      const side = def.alwaysOffer as SubstrateSide;
      const sideHasRates = [...sideByCode.values()].includes(side);
      if (sideHasRates) groups[side].push({ key: def.key, label: def.label, defaultOn: def.defaultOn });
      continue;
    }
    for (const side of sides) {
      groups[side].push({ key: def.key, label: def.label, defaultOn: def.defaultOn });
    }
  }
  return groups;
}

/** The pre-ticked "usual full repaint" for a job type, from offered options. */
export function defaultSurfacesFor(
  jobType: "interior" | "exterior" | "both",
  groups: SubstrateGroups,
): SubstrateKey[] {
  const pick = (opts: SubstrateOption[]) => opts.filter((o) => o.defaultOn).map((o) => o.key);
  if (jobType === "interior") return pick(groups.interior);
  if (jobType === "exterior") return pick(groups.exterior);
  return [...pick(groups.interior), ...pick(groups.exterior)];
}
