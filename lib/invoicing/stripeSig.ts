import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe webhook signature verification — the front door of the ONLY writer
 * of card-payment success (§5.3). Implemented against Stripe's documented
 * scheme (v1 = HMAC-SHA256 of `${timestamp}.${payload}`) with a replay
 * tolerance window; no SDK, same as the platform's other REST integrations.
 *
 * Pure given `nowSeconds`, so the unit tests exercise real signatures.
 */

export const STRIPE_SIG_TOLERANCE_SECONDS = 300;

export function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = STRIPE_SIG_TOLERANCE_SECONDS,
): boolean {
  if (!signatureHeader || !secret) return false;

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k?.trim() === "t") timestamp = v ?? "";
    if (k?.trim() === "v1" && v) signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, "utf8");
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}
