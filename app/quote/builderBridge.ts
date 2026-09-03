/**
 * The builder and the embedded assistant edit the SAME estimate row. The
 * builder saves on demand (no autosave) from its in-memory state, spreading
 * what it loaded — so a stale builder saving after the assistant wrote would
 * put the old tree back. The bridge lets the assistant (a) flush the
 * builder's unsaved edits BEFORE a turn and (b) have the page remount the
 * builder on the fresh row AFTER one. Module-level on purpose: both live on
 * one page and there is exactly one builder.
 */
type Builder = { save: () => Promise<unknown>; dirty: () => boolean };
let current: Builder | null = null;

export function registerBuilder(b: Builder | null) { current = b; }
export async function flushBuilder(): Promise<void> {
  if (current?.dirty()) await current.save();
}
