import { createHash } from "node:crypto";
import { documentBody } from "./source";

/**
 * The hash that pins a version's wording (brief §10: a change to the file
 * without a version bump fails CI). Over the document body only — the header
 * and the provenance note above the first section are not wording. Node only
 * (the seed, the tests, the server renderer).
 */
export const sha256Hex = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

export function agreementBodyHash(md: string): string {
  return sha256Hex(documentBody(md));
}
