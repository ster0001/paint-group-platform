/**
 * Wizard UI refresh — the switches from docs/briefs/wizard-ui-refresh-decisions.md.
 *
 * Typed constants, no Settings row, no migration (run sheet §1). Each one
 * ships at the decisions sheet's default until Tom writes a ruling there;
 * anything that would state a business fact ships OFF.
 */
export const UI_FLAGS = {
  /** ⚑ 1 — colour try-on swatches on the room picture (S2). Default OFF. */
  colourTryOn: false,
  /** ⚑ 2 / ⚑ 14 — the "A job like yours" card on the range screen (S3). Default OFF. */
  similarJobCard: false,
  /** ⚑ 10 — the chat lives in the header as an icon, not a floating bubble (S1). Default ON. */
  chatInHeader: true,
} as const;

export type UiFlag = keyof typeof UI_FLAGS;

/**
 * Exterior wizard v2 (brief §9 S2, ⚑ 17): the drawn-house outside path.
 * `NEXT_PUBLIC_EXTERIOR_V2=1` turns it on — set in `.env.test.local` and the
 * CI e2e job (ON on the test project), unset on Vercel (OFF in production)
 * until Tom flips it after S6. Read at call time so a test can stub it.
 */
export function exteriorV2On(): boolean {
  return process.env.NEXT_PUBLIC_EXTERIOR_V2 === "1";
}
