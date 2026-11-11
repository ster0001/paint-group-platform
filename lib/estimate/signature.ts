/**
 * The customer's drawn signature on an accepted estimate (Tom, 11 Nov 2026):
 * what the printed / downloaded estimate fills its signature lines with.
 *
 * Stored as a PNG data URL in `estimates.accepted_signature` (written only by
 * `save_estimate_signature`), read back by `estimate_signature_by_token` on the
 * token page and by the staff builder's own select. Both hand the raw value to
 * `toEstimateSignature`, the one place it is checked before it reaches an
 * `<img src>` — anything that is not a PNG data URL draws no image.
 */
export type EstimateSignature = {
  /** PNG data URL, or null when the image never stored (the name and date still print). */
  image: string | null;
  name: string | null;
  at: string | null;
};

const PNG_PREFIX = "data:image/png;base64,";
const MAX_LENGTH = 1_000_000;

export function isSignatureImage(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(PNG_PREFIX) && v.length <= MAX_LENGTH
    && /^[A-Za-z0-9+/]+=*$/.test(v.slice(PNG_PREFIX.length));
}

/** Null when nothing says the estimate was signed (no image, no name). */
export function toEstimateSignature(raw: { signature?: unknown; name?: unknown; at?: unknown } | null | undefined): EstimateSignature | null {
  if (!raw) return null;
  const image = isSignatureImage(raw.signature) ? raw.signature : null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null;
  const at = typeof raw.at === "string" && raw.at ? raw.at : null;
  if (!image && !name) return null;
  return { image, name, at };
}
