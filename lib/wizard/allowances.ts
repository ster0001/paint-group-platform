import { makeDraftSurface } from "@/lib/extract/draft";
import { substrateKeyForRateCode } from "@/lib/estimate/substrates";

/**
 * Per-room ALLOWANCES the engine owns (Tom, 7 Sep 2026):
 *
 *   · Colour match — a one-coat job still needs spot priming, extra patching
 *     and the same set-up and pack-up, so every interior room carries a
 *     colour-match allowance when the job is a colour match ("fresh").
 *   · Ceilings only — a ceiling painted without its walls costs more than
 *     its share of a whole-room repaint (masking, set-up for one surface),
 *     so a room with ceilings on and walls off carries a ceilings-only
 *     allowance.
 *
 * Both are RATE ROWS (Hours Per Item, migration 20270111, half an hour each
 * to start — Tom tunes them in Settings → Substrates); a row missing from
 * the card means no line, never a guess. The lines are marked `allowance`
 * so the customer editor shows them as an inclusion, not a tile to untick,
 * and this one function is re-run after every edit, so unticking the walls
 * of a room adds the ceilings-only allowance and ticking them back removes
 * it. Called by the submit route, the wizard-edit route and build-tree.
 */

export const ROOM_ALLOWANCES = {
  colourMatch: { code: "Colour Match Allowance", label: "Colour match — spot priming, extra patching, set-up and pack-up" },
  ceilingsOnly: { code: "Ceilings Only Allowance", label: "Ceilings on their own — extra set-up and masking" },
} as const;

/**
 * Ceilings without walls, as a RATE UPLIFT (Tom, 9 Sep: *"if ceilings are
 * being painted and walls aren't, we need to charge the ceiling and cornice at
 * a 30% higher rate"*).
 *
 * This replaces the flat `Ceilings Only Allowance` line for the same job.
 * A flat half-hour under-charges a big living room and over-charges a WC;
 * a percentage on the ceiling and cornice hours is what Tom actually does.
 * The old line is still REMOVED when it is present, so a job priced under the
 * previous rule reprices cleanly rather than carrying both.
 */
export const CEILINGS_ONLY_UPLIFT_PCT = 30;

/** The surfaces the uplift applies to — the ceiling and its cornice. */
const CEILING_KEYS = new Set(["ceilings", "cornices"]);

export type AllowanceSurface = Record<string, unknown> & { id?: number; code?: string; allowance?: boolean; internalLabel?: string };
export type AllowanceBlock = Record<string, unknown> & {
  id?: number; kind?: string; type?: string; areaType?: string; name?: string; surfaces?: AllowanceSurface[];
};
export type AllowanceRateRow = { code: string; category?: string | null; charge_out_cents?: number | null };

const isInteriorRoom = (b: AllowanceBlock) => b.kind === "area" && b.type !== "Exterior" && b.areaType !== "surface";

export function reconcileRoomAllowances<B extends AllowanceBlock>(
  blocks: B[],
  opts: {
    tier: string | null | undefined;
    rateItems: ReadonlyArray<AllowanceRateRow>;
    /** Tom's percentage; defaults to CEILINGS_ONLY_UPLIFT_PCT. */
    ceilingsOnlyUpliftPct?: number;
  },
  nextId: () => number,
): { blocks: B[]; changed: number } {
  const row = (code: string) => opts.rateItems.find((r) => r.code === code) ?? null;
  let changed = 0;
  const out = blocks.map((b) => {
    if (!isInteriorRoom(b)) return b;
    const surfaces = b.surfaces ?? [];
    const has = (key: string) => surfaces.some((s) => s.allowance !== true && substrateKeyForRateCode(String(s.code ?? "")) === key);
    // Ceilings without walls is now a rate uplift, not a line (see below), so
    // the only allowance LINE left is the colour match.
    const ceilingsOnly = has("ceilings") && !has("walls");
    const wants: Array<[keyof typeof ROOM_ALLOWANCES, boolean]> = [
      ["colourMatch", opts.tier === "fresh"],
      ["ceilingsOnly", false],
    ];
    let next: AllowanceSurface[] = surfaces;
    for (const [k, want] of wants) {
      const cfg = ROOM_ALLOWANCES[k];
      const r = row(cfg.code);
      const present = next.some((s) => s.allowance === true && String(s.code) === cfg.code);
      if (want && r && !present) {
        const line: AllowanceSurface = {
          ...(makeDraftSurface(nextId(), cfg.code, cfg.label, 1, "ai_derived", 0.9, []) as unknown as AllowanceSurface),
          internalLabel: cfg.label,
          allowance: true,
          // The row's own charge-out, not the room's category rate.
          ...(r.charge_out_cents ? { useCustomRate: true, customRate: r.charge_out_cents / 100 } : {}),
        };
        next = [...next, line];
        changed++;
      } else if ((!want || !r) && present) {
        next = next.filter((s) => !(s.allowance === true && String(s.code) === cfg.code));
        changed++;
      }
    }
    /**
     * The uplift itself. Set on the ceiling and cornice when the walls are
     * off, cleared the moment they come back on — so unticking and reticking
     * the walls is reversible, which a stored one-way flag would not be.
     */
    const pct = opts.ceilingsOnlyUpliftPct ?? CEILINGS_ONLY_UPLIFT_PCT;
    let touched = next !== surfaces;
    next = next.map((sf) => {
      if (sf.allowance === true) return sf;
      const key = substrateKeyForRateCode(String(sf.code ?? ""));
      if (key == null || !CEILING_KEYS.has(key)) return sf;
      const want = ceilingsOnly ? pct : 0;
      const current = Number((sf as { upliftPct?: unknown }).upliftPct) || 0;
      if (current === want) return sf;
      touched = true;
      changed++;
      return { ...sf, upliftPct: want };
    });

    return touched ? { ...b, surfaces: next } : b;
  });
  return { blocks: out, changed };
}

/** The allowance lines a room carries, as the customer reads them. */
export function roomAllowanceLabels(surfaces: ReadonlyArray<AllowanceSurface>): string[] {
  return surfaces.filter((s) => s.allowance === true).map((s) => String(s.internalLabel ?? s.code ?? "Allowance"));
}
