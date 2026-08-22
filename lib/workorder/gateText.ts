/**
 * The gate refusals come out of the database in the database's own vocabulary.
 *
 * The stage functions were written when the stage was called "QA", so a refusal
 * reads "3 QA checks still open". Tom renamed the stage to **Quality check**
 * on 22 Aug 2026, and every label in the console now says so — but the SQL
 * strings live inside `wo_advance_stage` and friends, and changing them means a
 * migration he has to run by hand against the live database.
 *
 * So the rename is finished here instead: one place, applied to every gate
 * message on its way to the screen. If those functions are ever redefined for
 * another reason, update the SQL and this mapping becomes a no-op rather than
 * a lie — it only rewrites text that is still in the old vocabulary.
 */
const REWRITES: [RegExp, string][] = [
  // "3 QA checks still open" / "1 QA check still open"
  [/\bQA checks\b/g, "quality checks"],
  [/\bQA check\b/g, "quality check"],
  // Anything else that still shouts the old abbreviation.
  [/\bQA\b/g, "quality check"],
];

/** A gate refusal in the console's own words. */
export function humaniseGate(message: string): string {
  return REWRITES.reduce((text, [from, to]) => text.replace(from, to), message);
}
