/**
 * Guarded fetch of a linked invoice document. SERVER ONLY.
 *
 * The URL came out of an email — hostile until proven boring. Rules:
 *   · https only; at most 3 manual redirects, each hop re-validated
 *   · the hostname must not resolve to a private/reserved address (SSRF)
 *   · 10s timeout, size capped, and the BYTES must sniff as a document —
 *     a login page or HTML error is discarded, never stored as "the invoice"
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MAX_UPLOAD_BYTES, sniffKind } from "@/lib/extract/normalise";

function privateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  return (
    p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    p[0] >= 224
  );
}

function privateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return privateV4(ip);
  if (v === 6) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80")) return true;
    const mapped = low.match(/^::ffff:([\d.]+)$/);
    if (mapped) return privateV4(mapped[1]);
    return false;
  }
  return true;
}

async function hostAllowed(hostname: string): Promise<boolean> {
  if (isIP(hostname)) return !privateIp(hostname);
  try {
    const addrs = await lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !privateIp(a.address));
  } catch {
    return false;
  }
}

export type FetchedDoc = { bytes: Uint8Array; filename: string; contentType: string };

/** Try each candidate URL in order; first one that yields a real document wins. */
export async function fetchLinkedDoc(urls: readonly string[]): Promise<FetchedDoc | null> {
  for (const start of urls.slice(0, 3)) {
    let url = start;
    for (let hop = 0; hop < 4; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        break;
      }
      if (parsed.protocol !== "https:") break;
      if (!(await hostAllowed(parsed.hostname))) break;

      let res: Response;
      try {
        res = await fetch(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
          headers: { accept: "application/pdf,image/*,*/*" },
        });
      } catch {
        break;
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        url = new URL(loc, url).toString();
        continue; // re-validated at the top of the loop
      }
      if (!res.ok) break;

      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_UPLOAD_BYTES) break;
      let buf: ArrayBuffer;
      try {
        buf = await res.arrayBuffer();
      } catch {
        break;
      }
      if (buf.byteLength === 0 || buf.byteLength > MAX_UPLOAD_BYTES) break;
      const bytes = new Uint8Array(buf);
      const kind = sniffKind(bytes);
      if (!kind) break; // an HTML login page is not an invoice

      const last = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
      const filename = /\.[a-z0-9]{2,4}$/i.test(last) ? last : `invoice.${kind}`;
      return { bytes, filename, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
    }
  }
  return null;
}
