/**
 * Inbound-email webhook signature (svix scheme — used by Resend's inbound
 * webhooks; Postmark would swap this module, nothing else). Mirrors
 * lib/invoicing/stripeSig.ts: hand-rolled HMAC, timing-safe compare, replay
 * window, pure given nowSeconds so tests sign real payloads.
 *
 * Secret env: BILLS_INBOUND_SECRET ("whsec_" + base64 key). ⚑16: until the
 * provider is settled and the secret set, the route answers 503 and the
 * pipeline is exercised through the e2e's self-signed deliveries.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

export function billsInboundConfigured(): boolean {
  return Boolean(process.env.BILLS_INBOUND_SECRET);
}

export type SvixHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export function verifyInboundSignature(
  payload: string,
  headers: SvixHeaders,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;

  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  // Header carries space-separated versioned signatures: "v1,<b64> v1,<b64>".
  for (const part of signature.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    const candidate = Buffer.from(sig);
    if (candidate.length === expectedBuf.length && timingSafeEqual(candidate, expectedBuf)) {
      return true;
    }
  }
  return false;
}

/** Build the signature for a payload — the e2e signs its own deliveries. */
export function signInboundPayload(
  payload: string,
  id: string,
  timestampSeconds: number,
  secret: string,
): SvixHeaders {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key)
    .update(`${id}.${timestampSeconds}.${payload}`)
    .digest("base64");
  return { id, timestamp: String(timestampSeconds), signature: `v1,${sig}` };
}
