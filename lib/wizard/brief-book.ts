import { z } from "zod";

/**
 * C14 — the BRIEF BOOKING contract (addendum S6c, §4.16, §4.17).
 *
 * The brief path never prices: nothing here imports the pricing engine, and
 * the unit test for this module asserts as much. The booking route creates
 * the estimate (no priced blocks, total 0), the brief row, the checklist
 * items, claims the photos, then runs the same account / property / request /
 * visit / magic-link steps Save & book runs — "atomic" by ROLLBACK: the
 * estimate is created first and deleted if any later step fails, which
 * cascades the brief, the request and the checklist.
 */

export const briefBookSchema = z.object({
  email: z.string().trim().email("That email doesn't look right.").max(200),
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  slot: z.string().trim().min(4).max(80).optional(),
  screen: z.string().trim().max(60).default("com_book"),
  brief: z.object({
    segment: z.string().min(1).max(40),
    briefKey: z.string().min(1).max(40),
    what: z.array(z.string().max(80)).max(20).default([]),
    answers: z.record(z.string().max(120), z.string().max(120)).default({}),
    notes: z.string().max(2000).default(""),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  }),
  /** The condition-photo rows already uploaded (run-less), to claim for the estimate. */
  sourceIds: z.array(z.string().uuid()).max(12).default([]),
  /** The walk as it stands, so the route can create the session if the flush has not landed. */
  snapshot: z.object({
    state: z.record(z.string(), z.unknown()),
    page: z.number().int().min(1).max(12).optional(),
    lastPage: z.number().int().min(1).max(12).optional(),
  }).optional(),
});
export type BriefBookInput = z.infer<typeof briefBookSchema>;

/** The estimate's title on the brief path: the street, else suburb + postcode, else the segment. */
export function briefTitle(state: { address?: { street?: string; formatted?: string } | null; customer?: { suburb?: string; postcode?: string } | null } | null | undefined, segmentName: string): string {
  const street = state?.address?.street?.trim() || state?.address?.formatted?.split(",")[0]?.trim() || "";
  if (street) return street;
  const place = [state?.customer?.suburb, state?.customer?.postcode].filter(Boolean).join(" ");
  return place || `${segmentName} — brief`;
}

/** One line for the draft and the CRM: what was booked, from where. */
export function briefOutcomeNote(slot: string | undefined, briefKey: string): string {
  return slot ? `Booked: ${slot} (brief: ${briefKey})` : `Call me back (brief: ${briefKey})`;
}

/**
 * The customer's confirmation, in the same voice as Save & book: what we
 * have, when, and that nothing is owed.
 */
export function briefEmailIntro(slot: string | undefined, segmentName: string): string {
  return `Thanks — your ${segmentName.toLowerCase()} brief and photos are with us. `
    + (slot ? `We've got you down for ${slot}. ` : "One of us will be in touch within one working day to arrange a time. ")
    + "We bring the brief with us, so the visit is quick. Nothing is booked in stone and nothing is owed.";
}
