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
  /**
   * Delivery is optional wording-only input: recipient + the words to say.
   * The link, totals and branding are derived server-side from the estimate
   * row and settings — the client never supplies the URL that gets sent.
   */
  email: z
    .object({
      to: z.string().trim().email("That email address doesn't look right."),
      subject: z.string().trim().min(1).max(200),
      message: z.string().trim().min(1).max(5000),
    })
    .nullish(),
  sms: z
    .object({
      to: z.string().trim().min(6, "That phone number doesn't look right.").max(20),
    })
    .nullish(),
});

export type SendEstimateInput = z.infer<typeof sendEstimateInput>;
