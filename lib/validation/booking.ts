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
    /** Final walkthrough, confirmed with the client at booking (Tom, 1 Sep:
     *  REQUIRED — date AND time — unless walkthrough not required is ticked). */
    walkthroughDate: isoDate.nullish(),
    walkthroughTime: z.string().regex(/^\d{2}:\d{2}$/, "expected a time as HH:MM").nullish(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "the end date cannot be before the start date",
    path: ["endDate"],
  })
  .refine((v) => !v.walkthroughRequired || (!!v.walkthroughDate && !!v.walkthroughTime), {
    message: "confirm the final walkthrough date and time with the client, or tick walkthrough not required",
    path: ["walkthroughDate"],
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

// ---- Employed painters (Session 2) ------------------------------------------
// Assignments carry dates and a lead, never an amount: the same rule as the
// offer inputs above. An employee is never sent a price, so there is nothing
// for a client to forge here even in principle.

const painterOnJob = z
  .object({ contractorId: uuid, startDate: isoDate, endDate: isoDate.nullish() })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "the end date cannot be before the start date",
    path: ["endDate"],
  });

export const assignJobInput = z
  .object({
    workOrderId: uuid,
    painters: z.array(painterOnJob).min(1, "pick at least one painter").max(12),
    leadContractorId: uuid,
    /** Set when the office knowingly schedules over a conflict — logged on the event. */
    overrideReason: z.string().trim().max(300).nullish(),
    /** The same sheet as an offer: QA flag + the final walkthrough confirmed with the client. */
    qaRequired: z.boolean().default(false),
    walkthroughRequired: z.boolean().default(true),
    walkthroughDate: isoDate.nullish(),
    walkthroughTime: z.string().regex(/^\d{2}:\d{2}$/, "expected a time as HH:MM").nullish(),
    /** Adding a painter to a job already booked: the walkthrough was settled the first time. */
    addingToBookedJob: z.boolean().default(false),
  })
  .refine((v) => v.addingToBookedJob || !v.walkthroughRequired || (!!v.walkthroughDate && !!v.walkthroughTime), {
    message: "confirm the final walkthrough date and time with the client, or tick walkthrough not required",
    path: ["walkthroughDate"],
  });

export const reassignDatesInput = z
  .object({
    assignmentId: uuid,
    startDate: isoDate,
    endDate: isoDate.nullish(),
    overrideReason: z.string().trim().max(300).nullish(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "the end date cannot be before the start date",
    path: ["endDate"],
  });

export const setLeadPainterInput = z.object({ workOrderId: uuid, contractorId: uuid });

export const releaseAssignmentInput = z.object({
  assignmentId: uuid,
  reason: z.string().trim().max(300).default(""),
});

export type AssignJobInput = z.infer<typeof assignJobInput>;
export type ReassignDatesInput = z.infer<typeof reassignDatesInput>;

export type SendOfferInput = z.infer<typeof sendOfferInput>;
export type WithdrawOfferInput = z.infer<typeof withdrawOfferInput>;
export type ReassignOfferInput = z.infer<typeof reassignOfferInput>;
export type MoveBookingInput = z.infer<typeof moveBookingInput>;
export type BlockOutInput = z.infer<typeof blockOutInput>;
