import type { Mode } from "./estimateLink";

/**
 * The self-typing estimator (brief §4.2) as a PURE schedule + a small
 * state machine, so the timing is unit-tested and the component only
 * plays it.
 *
 * 900 ms after mount the hero field types an example address character by
 * character (38–78 ms per character, jittered), the matching chip lights,
 * then a result line fades in beside the field: address → price range →
 * time label. It holds 3.2 s, fades (400 ms), and the next example starts.
 * Loops. It stops the instant the visitor touches the field or a chip and
 * never restarts in that session; reduced motion never starts it.
 *
 * ⚑9.1: replace EXAMPLES with real anonymised jobs when Tom supplies them.
 */
export type GhostExample = { address: string; mode: Mode; price: string; time: string };

export const GHOST_EXAMPLES: readonly GhostExample[] = [
  { address: "12 Elm Street, Northcote", mode: "home", price: "$8,400 – $9,600", time: "9 min to a range" },
  { address: "4/22 High Street, Northcote", mode: "business", price: "$3,100 – $3,600", time: "6 min · vacate paint" },
  { address: "9 Clarke Street, Thornbury", mode: "home", price: "$14,200 – $15,800", time: "11 min · exterior" },
  { address: "31 Separation St, Northcote", mode: "business", price: "$1,900 – $2,300", time: "5 min · touch-up" },
];

export const GHOST_START_DELAY_MS = 900;
export const GHOST_CHAR_MS: readonly [number, number] = [38, 78];
export const GHOST_HOLD_MS = 3200;
export const GHOST_FADE_MS = 400;
/** A breath between the fade and the next example's first character. */
export const GHOST_GAP_MS = 350;

export type GhostStep =
  | { at: number; kind: "type"; text: string; mode: Mode }
  | { at: number; kind: "result"; example: GhostExample }
  | { at: number; kind: "fade" }
  | { at: number; kind: "clear" };

/** One example's steps, relative to its own start. `rng` in [0,1) jitters each character. */
export function ghostSchedule(example: GhostExample, rng: () => number = Math.random): GhostStep[] {
  const [lo, hi] = GHOST_CHAR_MS;
  const steps: GhostStep[] = [];
  let at = 0;
  for (let i = 1; i <= example.address.length; i++) {
    at += Math.round(lo + (hi - lo) * rng());
    steps.push({ at, kind: "type", text: example.address.slice(0, i), mode: example.mode });
  }
  at += 220; // the beat before the answer
  steps.push({ at, kind: "result", example });
  at += GHOST_HOLD_MS;
  steps.push({ at, kind: "fade" });
  at += GHOST_FADE_MS;
  steps.push({ at, kind: "clear" });
  return steps;
}

export type GhostState = {
  status: "waiting" | "typing" | "result" | "fading" | "stopped";
  index: number;
  text: string;
  mode: Mode;
  result: GhostExample | null;
};

export const ghostInitial: GhostState = { status: "waiting", index: 0, text: "", mode: "home", result: null };

export function applyGhostStep(state: GhostState, step: GhostStep): GhostState {
  if (state.status === "stopped") return state;
  switch (step.kind) {
    case "type": return { ...state, status: "typing", text: step.text, mode: step.mode, result: null };
    case "result": return { ...state, status: "result", result: step.example };
    case "fade": return { ...state, status: "fading" };
    case "clear": return { ...state, status: "waiting", text: "", result: null, index: (state.index + 1) % GHOST_EXAMPLES.length };
  }
}

/** The visitor touched it: empty field, no result, chips back to "My home", never restarts. */
export function stopGhost(state: GhostState): GhostState {
  return { ...state, status: "stopped", text: "", result: null, mode: "home" };
}

/** Time from mount to the first visible character / the first result, for the ACs (worst case). */
export function ghostWorstCase(example = GHOST_EXAMPLES[0]): { firstCharMs: number; resultMs: number } {
  return {
    firstCharMs: GHOST_START_DELAY_MS + GHOST_CHAR_MS[1],
    resultMs: GHOST_START_DELAY_MS + example.address.length * GHOST_CHAR_MS[1] + 220,
  };
}
