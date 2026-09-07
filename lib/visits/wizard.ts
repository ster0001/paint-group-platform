/**
 * The wizard's slot list (P6). SERVER ONLY.
 *
 * Before P6 the customer saw six generated weekday strings with no
 * availability behind them. Now the list is the zone half-day windows the
 * availability engine offers — real estimators, real hours, minus booked
 * visits — still handed to the page as plain strings, so the confirm loop's
 * UI is unchanged. Booking a label books the window: the engine picks the
 * estimator and the block, and the database refuses a double-booking.
 *
 * Settings → Online estimates can still pin a hand-written list
 * (scope_editor.visitSlots); those book nothing automatically, as before.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { offeredVisitSlots } from "@/lib/wizard/scope-editor";
import { bookWindow, offeredVisitWindows, type BookResult } from "./book";

export type WizardSlots = { labels: string[]; keyOf: Record<string, string> };

export async function wizardVisitSlots(db: SupabaseClient, flags: { visitSlots?: string[] }, now = new Date()): Promise<WizardSlots> {
  if (Array.isArray(flags.visitSlots) && flags.visitSlots.length) return { labels: offeredVisitSlots(flags), keyOf: {} };
  try {
    const { windows } = await offeredVisitWindows(db, now);
    if (windows.length === 0) return { labels: offeredVisitSlots({}), keyOf: {} };
    const keyOf: Record<string, string> = {};
    for (const w of windows) keyOf[w.label] = w.key;
    return { labels: windows.slice(0, 12).map((w) => w.label), keyOf };
  } catch {
    return { labels: offeredVisitSlots({}), keyOf: {} };
  }
}

/** Book the window behind a label the customer picked. Null when the label books nothing (a pinned list). */
export async function bookWizardSlot(
  db: SupabaseClient, slots: WizardSlots, label: string,
  input: { accountId: string | null; estimateId: string; note?: string | null },
): Promise<BookResult | null> {
  const key = slots.keyOf[label];
  if (!key) return null;
  return bookWindow(db, key, { accountId: input.accountId, estimateId: input.estimateId, kind: "quote", source: "wizard", note: input.note ?? null });
}
