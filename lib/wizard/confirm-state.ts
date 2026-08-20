import { isSideBlock, type SidesLoopMeta, type LooseBlock as SideBlock } from "./sides";
import type { InteriorLoopMeta } from "./rooms-loop";

/**
 * R5: which areas the customer's confirm loop can actually settle, and how
 * far through it they are.
 *
 * This exists so the confidence score can rise as the loop is worked
 * (accuracy.ts `confirmState`). It must name ONLY the areas a customer can
 * confirm from a card: interior rooms and the four exterior sides. The
 * whole-job "Exterior - Extras" block has no card of its own, so it is
 * deliberately absent — left in, it would sit "pending" forever and cap the
 * score at a number the customer could never move.
 *
 * Pure, and shared by the scope page and the wizard-edit route so both
 * report the same number. (R1.4's rule: one confidence function, one input.)
 */

export type ConfirmState = "pending" | "confirmed";

type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; name?: string; type?: string;
  areaType?: string; isOption?: boolean;
  customer?: { confirmed?: boolean };
};

/** An interior room card — the loop confirms these one at a time. */
function isLoopRoom(b: LooseBlock): boolean {
  return b.kind === "area" && b.type !== "Exterior" && b.areaType !== "surface";
}

/** One of the four exterior sides — sides.ts's own test, so the two can
 * never drift apart. The whole-job extras block fails it, which is the
 * point: nothing can confirm that block from a card. */
const isLoopSide = (b: LooseBlock) => isSideBlock(b as SideBlock);

export type LoopConfirmState = {
  /** areaId → where that area sits in the loop. Areas absent from this map
   * are not confirmable and score exactly as they did before R5. */
  states: Map<number, ConfirmState>;
  /** Whole-job checks the customer has settled (doors & windows totals, the
   * missed-rooms sweep, exterior condition and extras). */
  checksDone: number;
};

export function loopConfirmState(
  blocks: unknown[],
  interior: InteriorLoopMeta | null,
  sides: SidesLoopMeta | null,
): LoopConfirmState {
  const loose = blocks as LooseBlock[];
  const states = new Map<number, ConfirmState>();

  const hasInteriorLoop = interior != null && loose.some(isLoopRoom);
  const hasSidesLoop = sides != null && loose.some(isLoopSide);

  for (const b of loose) {
    const inLoop = (hasInteriorLoop && isLoopRoom(b)) || (hasSidesLoop && isLoopSide(b));
    if (!inLoop) continue;
    // An excluded side ("we're not painting that one") sits outside the
    // total, so it is settled, not pending.
    if (b.isOption === true) continue;
    states.set(Number(b.id) || 0, b.customer?.confirmed === true ? "confirmed" : "pending");
  }

  let checksDone = 0;
  if (hasInteriorLoop && interior) {
    checksDone += Number(interior.done.dw) + Number(interior.done.sweep);
  }
  if (hasSidesLoop && sides) {
    const d = sides.done as Record<string, boolean>;
    checksDone += Number(!!d.dw) + Number(!!d.sweep) + Number(!!d.cond) + Number(!!d.extras);
  }
  return { states, checksDone };
}
