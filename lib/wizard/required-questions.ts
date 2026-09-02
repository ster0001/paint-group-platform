/**
 * The confirm-loop's REQUIRED questions, as data (assistant brief §4).
 *
 * Both consumers read this one list:
 *   - the editors' gates (rooms-loop confirmRoom, sides confirmSide) refuse
 *     to confirm an area while a required question is unanswered;
 *   - the assistant's question graph (lib/agent/question-graph.ts) asks the
 *     same questions, in this order, and nothing else as "required".
 *
 * Add a question here and BOTH pick it up — the graph is never edited to
 * learn a new editor rule (S2 acceptance). Kept free of imports from the
 * editors so neither side depends on the other; the editor passes what the
 * check needs in `ctx`.
 */

export type RoomBlockLike = {
  origin?: unknown;
  assumedFields?: unknown;
  /** "ns" is the sides loop's not-sure; rooms never store it, but the graph
   *  reads both block shapes through this one type. */
  customer?: { size?: "yes" | "adjusted" | "ns" | null; cup?: boolean | null; cupInterior?: boolean | null; confirmed?: boolean };
};

/** Dimensions that were READ (plan, photo, person) rather than filled from a
 *  typical default. The graph asks these as a one-time confirm, never as a
 *  required question (§4 "known ≠ asked"). */
export function roomDimsKnown(room: RoomBlockLike): boolean {
  const assumed = Array.isArray(room.assumedFields) ? (room.assumedFields as unknown[]) : [];
  if (assumed.includes("L") || assumed.includes("W")) return false;
  return room.origin !== "ai_assumed" && room.origin != null;
}

export type RoomGateCtx = {
  /** The room type has a cupboard question AND the code is on the active card. */
  cupboardApplies: boolean;
};

export type RoomRequiredQuestion = {
  /** Stable key — the graph's gap key is `room.<areaId>.<key>`. */
  key: string;
  /** How the assistant phrases it (the model rewords; it never picks). */
  phrasing: string;
  /** Applies to this room at all? */
  applies: (room: RoomBlockLike, ctx: RoomGateCtx) => boolean;
  answered: (room: RoomBlockLike, ctx: RoomGateCtx) => boolean;
  /** The editor's refusal when confirming with this unanswered. */
  refusal: string;
  /** The wizard-edit action that records the answer. */
  action: string;
  acceptsNotSure: boolean;
  /** When true for a room, the value is already KNOWN from evidence and the
   *  graph asks it as a confirm (once, in the sweep) rather than required. */
  knownFrom?: (room: RoomBlockLike, ctx: RoomGateCtx) => boolean;
};

export const ROOM_REQUIRED_QUESTIONS: ReadonlyArray<RoomRequiredQuestion> = [
  {
    key: "size",
    phrasing: "Is this room about {L} m by {W} m? Say \"looks right\", give me the size, or \"not sure\".",
    applies: () => true,
    answered: (r) => r.customer?.size != null,
    refusal: "The size question still needs an answer — “Looks right” or adjust it.",
    action: "room_dims",
    acceptsNotSure: true,
    knownFrom: roomDimsKnown,
  },
  {
    key: "cupboards",
    phrasing: "Are we painting the cupboards in this room? Yes or no is all it takes.",
    applies: (_r, ctx) => ctx.cupboardApplies,
    answered: (r) => r.customer?.cup != null,
    refusal: "The cupboard question still needs an answer — yes or no is all it takes.",
    action: "room_cupboard",
    acceptsNotSure: false,
  },
];

/** The first unanswered required question's refusal, or null when the room
 *  may confirm. The editors' gate. */
export function roomGateError(room: RoomBlockLike, ctx: RoomGateCtx, questions = ROOM_REQUIRED_QUESTIONS): string | null {
  for (const q of questions) if (q.applies(room, ctx) && !q.answered(room, ctx)) return q.refusal;
  return null;
}

export type SideBlockLike = {
  customer?: { include?: boolean | null; size?: "yes" | "adjusted" | "ns" | null; confirmed?: boolean };
};

export type SideGateCtx = {
  /** The side carries wall lines at all. */
  hasWalls: boolean;
  /** Sum of the wall lines' shares, in percent. */
  wallSumPct: number;
};

export type SideRequiredQuestion = {
  key: string;
  phrasing: string;
  applies: (side: SideBlockLike, ctx: SideGateCtx) => boolean;
  answered: (side: SideBlockLike, ctx: SideGateCtx) => boolean;
  /** May depend on the ctx (the wall-mix message names the percentage). */
  refusal: (side: SideBlockLike, ctx: SideGateCtx) => string;
  action: string;
  acceptsNotSure: boolean;
};

const included = (s: SideBlockLike) => s.customer?.include === true;

export const SIDE_REQUIRED_QUESTIONS: ReadonlyArray<SideRequiredQuestion> = [
  {
    key: "include",
    phrasing: "Are we painting the {side} of the house?",
    applies: () => true,
    answered: (s) => s.customer?.include != null,
    refusal: () => "“Are we painting this side?” still needs an answer.",
    action: "side_include",
    acceptsNotSure: false,
  },
  {
    key: "size",
    phrasing: "Roughly how long and how high is the {side}? \"Not sure\" is fine.",
    applies: included,
    answered: (s) => s.customer?.size != null,
    refusal: () => "The side's size still needs an answer — “not sure” is fine.",
    action: "side_dims",
    acceptsNotSure: true,
  },
  {
    // Tom, 31 Aug: shares may total UNDER 100% (glass, garage doors) — only an
    // over-committed mix or an all-zero one is unanswered.
    key: "wall_mix",
    phrasing: "What is the {side} made of — roughly what share is each surface?",
    applies: (s, ctx) => included(s) && ctx.hasWalls,
    answered: (_s, ctx) => ctx.wallSumPct > 0 && ctx.wallSumPct <= 100,
    refusal: (_s, ctx) => ctx.wallSumPct > 100
      ? `The wall surfaces add up to ${ctx.wallSumPct}% — they can't total more than 100%.`
      : "Give at least one wall surface a share — or “No — skip this side” if none of it is being painted.",
    action: "wall_share",
    acceptsNotSure: false,
  },
];

export function sideGateError(side: SideBlockLike, ctx: SideGateCtx, questions = SIDE_REQUIRED_QUESTIONS): string | null {
  for (const q of questions) if (q.applies(side, ctx) && !q.answered(side, ctx)) return q.refusal(side, ctx);
  return null;
}
