import { z } from "zod";

/** Input schemas for the estimate lifecycle actions. */

const uuid = z.string().uuid("expected an id");

export const estimateStatus = z.enum(["draft", "sent", "accepted", "declined", "expired"]);

/**
 * Sending carries no money and no snapshot — the snapshot was written by the
 * save that precedes it, and the total lives inside that snapshot. This action
 * only moves the lifecycle forward, guarded by the status the screen believed
 * it was in.
 */
export const sendEstimateInput = z.object({
  estimateId: uuid,
  expectedStatus: estimateStatus,
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export type SendEstimateInput = z.infer<typeof sendEstimateInput>;
