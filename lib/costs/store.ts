/**
 * cost-docs storage — the raw source documents. SERVER ONLY.
 *
 * Path contract (mirrors lib/uploads/incoming.ts, but the bills webhook has
 * no user id):
 *   bills/{yyyy-mm}/{safeKey}/{safeName}   — service-role writes (webhooks)
 *   receipts/{userId}/{stamp}-{safeName}   — staff signed uploads (manual/6b)
 * A crafted path must never reach a storage call: conservative characters
 * only, no traversal.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const COST_DOCS_BUCKET = "cost-docs";

/** Message ids arrive from outside — reduce to a short, safe, stable key. */
export function safeDocKey(messageId: string): string {
  const cleaned = messageId
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .slice(0, 40);
  const hash = createHash("sha256").update(messageId).digest("hex").slice(0, 12);
  return cleaned ? `${cleaned}-${hash}` : hash;
}

export function safeFileName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export function billsDocPath(yyyyMm: string, messageId: string, fileName: string): string {
  if (!/^\d{4}-\d{2}$/.test(yyyyMm)) throw new Error("bad bills path month");
  return `bills/${yyyyMm}/${safeDocKey(messageId)}/${safeFileName(fileName, "document")}`;
}

/** True only for a clean path inside the staff receipts prefix (manual door). */
export function isOwnReceiptPath(path: string, userId: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 400) return false;
  if (path.includes("..") || path.includes("\\") || path.includes("//")) return false;
  if (path.startsWith("/")) return false;
  const prefix = `receipts/${userId}/`;
  if (!path.startsWith(prefix)) return false;
  return /^[A-Za-z0-9._-]{1,120}$/.test(path.slice(prefix.length));
}

/** Store one document; returns the path or null (storage failure is loud in
 *  the caller — an intake row without its doc must not confirm). */
export async function storeCostDoc(
  service: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  const { error } = await service.storage
    .from(COST_DOCS_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  return error ? null : path;
}
