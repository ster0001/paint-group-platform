import { substrateKeyForRateCode, substrateOptionsFromRates } from "@/lib/estimate/substrates";
import { rateCodeForCustomerAdd } from "./scope-editor";

/**
 * R5 (Tom, 20 Aug): "add all interior/exterior surfaces to the tiles in the
 * drop down to be able to add".
 *
 * The add panel used to offer a sliver of what we actually paint: interior
 * showed only the room type's own optional scope rules plus the ONE rate row
 * filed under Interior/Extras (an air vent), and a side showed four cladding
 * codes plus four catalogue extras. Picture rails, a mantle, interior
 * balustrades, eaves, gutters, downpipes, posts, columns, shutters, a roof —
 * all real rows on the live card — could not be added by a customer at all.
 *
 * These helpers derive the offer FROM THE RATE CARD, so a row added to the
 * card tomorrow appears in the panel with no code change, and a row that is
 * not on the card is offered NOWHERE (never a silent $0 — the same rule the
 * sides catalogue already followed).
 *
 * What is deliberately excluded, in both lists, is anything another control
 * already owns: the cupboard question owns the cabinetry rows, the family
 * tiles own the door and window style variants, and the wall %-mix control
 * owns the cladding codes.
 */

export type AddOption = {
  /** A substrate tick (toggle_surface) or a rate-card row (add by code). */
  via: "substrate" | "code";
  key: string;
  label: string;
  /** Grouping header in the panel, straight off the card's sub-category. */
  group: string;
};

type LooseRateItem = {
  code: string | null; category: string | null; sub_category?: string | null;
  unit?: string | null; charge_out_cents?: number | null;
};

/** Rows a customer must not add directly — another control owns them. */
const CABINETRY = new Set([
  "Kitchen Cupboard Front", "Robe Door", "Vanity Door",
  "Kitchen Cupboard Interior", "Robe Interior", "Vanity Interior", "Linen / Broom Cupboard Interior",
]);

/**
 * Allowances are an ESTIMATOR's judgement in hours — plastering, sealing raw
 * timber, access. They price by the hour, so a customer tapping one would be
 * buying an hour of something they cannot scope. Offered in capture and the
 * builder, never in the customer's add panel.
 */
const isAllowance = (subCategory: string | null | undefined) =>
  (subCategory ?? "").trim().toLowerCase() === "allowances";

/** Whole-job exterior items that belong to the sweep, not to one side. */
const WHOLE_JOB_EXTERIOR = new Set(["Shed", "Pressure Washing", "Access Allowance", "Minor Fascia Rot Allowance"]);

const TITLE: Record<string, string> = {
  "Fixed / Picture / Window Reveal": "Window reveals",
  "Window Reveal": "Window reveals",
  "Soffits / Exterior Ceilings": "Soffits",
  "Cutek": "Timber stain (Cutek)",
  "Deck Painting": "Deck",
  "Hand Rails": "Balustrades & hand rails",
  "Roof": "Roof",
};

/** Sentence case off a rate code, which is written for estimators. */
function prettify(code: string): string {
  if (TITLE[code]) return TITLE[code];
  return code.charAt(0).toUpperCase() + code.slice(1).toLowerCase()
    .replace(/\bmdf\b/i, "MDF");
}

/**
 * Everything a customer can add to ONE INTERIOR ROOM: every interior
 * substrate the card can price (not just the ones this room type happens to
 * list), then the interior rate rows no substrate tick covers.
 */
export function interiorAddOptions(rateItems: ReadonlyArray<LooseRateItem>): AddOption[] {
  const out: AddOption[] = [];

  for (const s of substrateOptionsFromRates(rateItems).interior) {
    // Only substrates the customer-add mapper can turn into a real code —
    // `staircase` has no rate row and raises a whole-job deferral instead.
    if (!rateCodeForCustomerAdd(s.key, null)) continue;
    out.push({ via: "substrate", key: s.key, label: s.label, group: "The usual surfaces" });
  }

  for (const r of rateItems) {
    const code = r.code;
    if (!code || r.category !== "Interior") continue;
    if (CABINETRY.has(code) || isAllowance(r.sub_category)) continue;
    // Style variants ride their family tile (Doors / Windows), and anything
    // a substrate tick governs is already offered above.
    if (substrateKeyForRateCode(code) != null) continue;
    out.push({ via: "code", key: code, label: prettify(code), group: r.sub_category || "Also on our card" });
  }
  return out;
}

/**
 * Everything a customer can add to ONE EXTERIOR SIDE. Cladding is excluded:
 * a side's wall mix is a percentage split, not a tick, so it keeps its own
 * "+ … — wall surface" control that auto-balances the shares.
 */
export function exteriorAddOptions(rateItems: ReadonlyArray<LooseRateItem>): AddOption[] {
  const out: AddOption[] = [];
  for (const r of rateItems) {
    const code = r.code;
    if (!code || r.category !== "Exterior") continue;
    if (WHOLE_JOB_EXTERIOR.has(code) || isAllowance(r.sub_category)) continue;
    if ((r.sub_category ?? "") === "Cladding") continue;
    out.push({ via: "code", key: code, label: prettify(code), group: r.sub_category || "Also on our card" });
  }
  return out;
}

/**
 * The charge-out a customer-added line must ride, in DOLLARS, or null to use
 * the category rate.
 *
 * The trap (parity batch, 20 Aug): rows like Air Vent, Security Door and
 * Meter Box carry their OWN charge-out — bill them at the category rate and
 * the price lands wrong. But pinning a custom rate on an ordinary row would
 * also override a per-estimate hourly override, so only a row that actually
 * DIFFERS from its category's base rate gets pinned.
 */
export function perItemChargeOut(
  rateItems: ReadonlyArray<LooseRateItem>,
  category: "Interior" | "Exterior",
  code: string,
): number | null {
  const item = rateItems.find((r) => r.code === code && r.category === category);
  if (!item || item.charge_out_cents == null) return null;
  const rows = rateItems.filter((r) => r.category === category);
  const base = rows.find((r) => !/extras|allowances/i.test(r.sub_category ?? "")) ?? rows[0];
  if (base?.charge_out_cents === item.charge_out_cents) return null;
  return item.charge_out_cents / 100;
}
