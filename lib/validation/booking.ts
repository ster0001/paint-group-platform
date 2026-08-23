import { z } from "zod";

/**
 * Input schemas for the booking server actions.
 *
 * Note what is NOT here: any amount. The contractor's payment is derived
 * server-side from stored pricing data, so there is no field for a client to
 * forge. If you ever find yourself adding `paymentCents` to one of these, stop.
 */

const uuid = z.string().uuid("expected an id");
/** Plain calendar date, never an instant — timezones must not shift a booking. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a date as YYYY-MM-DD");

/** The states a staff action may claim a row is currently in. */
export const offerState = z.enum([
  "offered", "proposed", "accepted", "declined", "expired", "withdrawn", "cancelled",
]);

export const sendOfferInput = z
  .object({
    workOrderId: uuid,
    contractorId: uuid,
    startDate: isoDate,
    endDate: isoDate.nullish(),
    note: z.string().max(500).default(""),
    /** "Quality check required on this job" — ticked when booking in (Tom, 23 Aug). */
    qaRequired: z.boolean().default(false),
    /** "Walkthrough not required" — the job closes after finish (+ QA) with no customer walkthrough. */
    walkthroughRequired: z.boolean().default(true),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "the end date cannot be before the start date",
    path: ["endDate"],
  });

export const withdrawOfferInput = z.object({
  offerId: uuid,
  /** What the screen believed the state was — the stale-tab guard. */
  expectedState: offerState,
});

export const reassignOfferInput = z
  .object({
    offerId: uuid,
    newContractorId: uuid,
    startDate: isoDate,
    endDate: isoDate.nullish(),
    expectedState: offerState.default("offered"),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "the end date cannot be before the start date",
    path: ["endDate"],
  });

export const moveBookingInput = z
  .object({
    offerId: uuid,
    startDate: isoDate,
    endDate: isoDate.nullish(),
    expectedState: offerState.default("accepted"),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "the end date cannot be before the start date",
    path: ["endDate"],
  });

export const blockOutInput = z
  .object({
    contractorId: uuid,
    startDate: isoDate,
    endDate: isoDate,
    reason: z.string().max(200).default(""),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "the last day cannot be before the first",
    path: ["endDate"],
  });

export type SendOfferInput = z.infer<typeof sendOfferInput>;
export type WithdrawOfferInput = z.infer<typeof withdrawOfferInput>;
export type ReassignOfferInput = z.infer<typeof reassignOfferInput>;
export type MoveBookingInput = z.infer<typeof moveBookingInput>;
export type BlockOutInput = z.infer<typeof blockOutInput>;
