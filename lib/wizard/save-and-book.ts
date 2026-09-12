import { z } from "zod";

/**
 * C8 — Save & book (addendum §4.17), the pure half.
 *
 * "We keep everything you've entered so far, and a person picks it up from
 * exactly here." The route (`app/api/wizard/save-and-book`) does the writes;
 * this file holds what can be decided without a database: the input shape,
 * what the session's outcome note says, whether a second tap is a repeat,
 * and where the magic link should land.
 *
 * ⚑26: email is required (it is the magic link), mobile optional.
 */
export const saveAndBookSchema = z.object({
  email: z.string().trim().email("That email doesn't look right.").max(200),
  phone: z.string().trim().max(40).optional(),
  name: z.string().trim().max(120).optional(),
  /** One of the offered visit windows, verbatim; absent = "call me back". */
  slot: z.string().trim().min(4).max(80).optional(),
  /** Where they are — the quick-look step or page label (`last_screen`). */
  screen: z.string().trim().max(60),
  /** The estimate, once the reveal has made one. Before that, the session is the draft. */
  estimateId: z.string().uuid().optional(),
  /**
   * The walk as the sheet sees it. The client flushes the draft before
   * opening the sheet, but a fast walk can post before that first insert has
   * landed — so the route can create the session from this rather than lose
   * the promise to a race it cannot see.
   */
  snapshot: z.object({
    state: z.record(z.string(), z.unknown()),
    page: z.number().int().min(1).max(12).optional(),
    lastPage: z.number().int().min(1).max(12).optional(),
  }).optional(),
});
export type SaveAndBookInput = z.infer<typeof saveAndBookSchema>;

/** The session's `outcome_note`, read by the work queue's card. */
export function outcomeNoteFor(slot: string | undefined, screen: string): string {
  return slot ? `Booked: ${slot} (Save & book from ${screen})` : `Call me back (Save & book from ${screen})`;
}

/**
 * A second tap of the same button is a double tap, not a second job. The
 * draft already carries the email and the same note, so nothing is written
 * again and no second email goes out.
 */
export function isRepeat(
  draft: { email?: string | null; outcome?: string | null; outcome_note?: string | null } | null | undefined,
  input: Pick<SaveAndBookInput, "email" | "slot" | "screen">,
): boolean {
  if (!draft) return false;
  return draft.outcome === "visit_requested"
    && (draft.email ?? "").toLowerCase() === input.email.toLowerCase()
    && draft.outcome_note === outcomeNoteFor(input.slot, input.screen);
}

/** Where the magic link opens: the estimate when there is one, else the wizard, which resumes the draft. */
export function resumeNext(estimateId: string | undefined | null): string {
  return estimateId ? `/estimate/scope?id=${estimateId}` : "/estimate";
}

/** A phone number is optional, but a typed one has to look like one. */
export function phoneOrNull(phone: string | undefined): string | null {
  const digits = (phone ?? "").replace(/[^0-9+]/g, "");
  return digits.replace(/\D/g, "").length >= 8 ? (phone ?? "").trim() : null;
}
