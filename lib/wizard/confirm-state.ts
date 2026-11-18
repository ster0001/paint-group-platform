import { defaultSidesLoop, isSideBlock, type SidesLoopMeta, type LooseBlock as SideBlock } from "./sides";
import { defaultInteriorLoop, type InteriorLoopMeta } from "./rooms-loop";

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

/**
 * Go-live brief C1 (18 Nov 2026): the quote stage settles a room on its MEASURE card, not a
 * "Confirm" button — "Looks right" / "Not sure" takes the typical size (`customer.size = "yes"`),
 * typing a size measures it (`"adjusted"`). Both count as settled for the accuracy score and the
 * range; a measured room is the tighter of the two (envelope.ts sizeResidualPct: 15 → 12 → 8).
 */
export type ConfirmState = "pending" | "confirmed" | "measured";

type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; name?: string; type?: string;
  areaType?: string; isOption?: boolean;
  customer?: { confirmed?: boolean; size?: "yes" | "adjusted" | null };
};

/** Where one loop area sits: measured (a typed size), confirmed (settled at the typical, or the old Confirm), else pending. */
export function confirmStateOf(b: LooseBlock): ConfirmState {
  if (b.customer?.size === "adjusted") return "measured";
  if (b.customer?.confirmed === true || b.customer?.size === "yes") return "confirmed";
  return "pending";
}

/** Settled = confirmed or measured — what the strip's "N of N" and the residual count. */
export const isSettled = (s: ConfirmState | undefined): boolean => s === "confirmed" || s === "measured";

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
    states.set(Number(b.id) || 0, confirmStateOf(b));
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

/**
 * C7b — "9 of 9" for the estimates list and the strip: loop areas the
 * customer has confirmed, of the loop areas that exist. Reads the SAME map
 * `loopConfirmState` builds for the confidence score, so the count a person
 * sees and the count the score credits can never differ. Null when the
 * estimate has no loop at all (an in-house build) — never "0 of 0".
 */
export function loopProgress(builderState: unknown): { confirmed: number; total: number; unit: "rooms" | "sides" } | null {
  const st = (builderState ?? {}) as { blocks?: unknown[]; interiorLoop?: InteriorLoopMeta; sidesLoop?: SidesLoopMeta };
  const blocks = Array.isArray(st.blocks) ? st.blocks : [];
  if (blocks.length === 0) return null;
  const { states } = loopConfirmState(blocks, st.interiorLoop ?? defaultInteriorLoop(), st.sidesLoop ?? defaultSidesLoop());
  if (states.size === 0) return null;
  let confirmed = 0;
  for (const v of states.values()) if (isSettled(v)) confirmed++;
  const hasRooms = (blocks as LooseBlock[]).some((b) => states.has(Number(b.id) || 0) && isLoopRoom(b));
  return { confirmed, total: states.size, unit: hasRooms ? "rooms" : "sides" };
}
