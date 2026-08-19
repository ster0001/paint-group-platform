/**
 * The pre-send review gate (master plan Step 6): everything on an estimate
 * that is still an ASSUMPTION, ordered by what it could cost, with the $150
 * rule - if the unresolved dollar impact exceeds the threshold, sending needs
 * an explicit acknowledgement.
 *
 * Impact figures here are deliberately rough-but-honest ESTIMATES for
 * ordering and thresholding - the real price is always lib/pricing's. Each
 * item says how its number was reached.
 */
import {
  chargeOutCents,
  itemIndex,
  priceArea,
  resolveRates,
  type Adjustments,
  type AreaInput,
  type PricingContext,
} from "@/lib/pricing/estimate";
import { hoursPerUnit } from "@/lib/pricing/engine";

export type ReviewItem = {
  areaId: number | null;
  label: string;
  needs: string;
  impactCents: number;
  basis: string;
};

export type AiDeferred = { room: string; what: string; count: number; needs: string };

/** Default threshold - cents. Overridable via the settings row if one exists. */
export const REVIEW_GATE_CENTS = 15000;

type NodeSurface = {
  code: string; internalLabel?: string; prepHr?: number;
  assumedFields?: string[];
};
type Node = {
  id: number; kind: string; name?: string; type?: string; L?: number; W?: number; H?: number;
  roomType?: string; isOption?: boolean;
  surfaces?: NodeSurface[];
  origin?: string; assumedFields?: string[];
};

const CHEAPEST_WINDOW = ["Fixed / Picture / Window Reveal", "Awning / Casement Window", "Double Hung Sash", "Colonial / Bay Window"];

export function reviewGate(
  blocks: Node[],
  ctx: PricingContext,
  adj: Adjustments,
  typicalSizes: Record<string, { L: number; W: number }>,
  aiDeferred: AiDeferred[] = [],
): { items: ReviewItem[]; totalImpactCents: number } {
  const items: ReviewItem[] = [];
  const idx = itemIndex(ctx.rateItems);
  const rates = resolveRates(ctx, adj);
  const charge = (type: string) => chargeOutCents(type, ctx.rateItems, rates.hourlyRateOverride);

  for (const b of blocks) {
    if (b.kind !== "area" || b.isOption) continue;
    const surfaces = b.surfaces ?? [];

    // Unmeasured room: it prices at ZERO today, which is exactly the danger.
    // Impact = what it would price at the room type's typical size.
    if ((!b.L || !b.W) && surfaces.length > 0) {
      const typ = typicalSizes[b.roomType ?? ""] ?? typicalSizes["bedroom"] ?? { L: 3.5, W: 3.25 };
      const impact = priceArea(
        { ...(b as unknown as AreaInput), L: typ.L, W: typ.W, H: b.H || 2.4 },
        ctx, adj,
      );
      items.push({
        areaId: b.id,
        label: b.name ?? "Unnamed area",
        needs: "no measurements - currently priced at $0",
        impactCents: impact,
        basis: `typical ${b.roomType ?? "room"} ${typ.L}x${typ.W} m`,
      });
    }

    // Photo-detected prep awaiting confirmation.
    for (const s of surfaces) {
      if (s.assumedFields?.includes("prep") && (s.prepHr ?? 0) > 0) {
        items.push({
          areaId: b.id,
          label: `${b.name ?? "Area"} - ${s.internalLabel ?? s.code}`,
          needs: "photo-detected prep to confirm",
          impactCents: Math.round((s.prepHr ?? 0) * charge(b.type ?? "Interior")),
          basis: `${s.prepHr} h prep at the charge-out rate`,
        });
      }
    }
  }

  // Deferred openings from the plan reader: seen on the plan, unpriced until
  // a human picks the style. Impact = count at the CHEAPEST plausible rate,
  // so the gate understates rather than inflates.
  for (const d of aiDeferred) {
    let code: string | null = null;
    if (/door/i.test(d.what)) code = "Flat Door and Frame (1 Side)";
    else if (/window/i.test(d.what)) {
      code = CHEAPEST_WINDOW.find((c) => idx.get(`Interior::${c}`)) ?? null;
    } else if (/cornice/i.test(d.what)) code = "Standard Cornices";
    const item = code ? idx.get(`Interior::${code}`) : undefined;
    // A deferral the gate cannot price (wizard kinds: damage, staircase,
    // envelope, oil-to-water...) is UNBOUNDED uncertainty - it must trip the
    // gate by itself, never slip past it at $0.
    let impact = REVIEW_GATE_CENTS;
    let basis = "unpriceable - requires review before sending";
    if (item) {
      if (item.unit === "Hours Per Item") {
        impact = Math.round(hoursPerUnit(item, 2) * d.count * charge("Interior"));
        basis = `${d.count} x ${code} at 2 coats`;
      } else {
        // lineal (cornices): a typical room's perimeter as the honest stand-in
        const perim = 14;
        impact = Math.round(perim * hoursPerUnit(item, 2) * charge("Interior"));
        basis = `~${perim} lineal m of ${code}`;
      }
    }
    items.push({ areaId: null, label: d.room, needs: `${d.what} - ${d.needs}`, impactCents: impact, basis });
  }

  items.sort((a, b) => b.impactCents - a.impactCents);
  return { items, totalImpactCents: items.reduce((n, i) => n + i.impactCents, 0) };
}
