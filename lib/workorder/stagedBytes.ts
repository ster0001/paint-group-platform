import { get as httpsGet } from "node:https";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The first bytes of a staged upload, through a signed URL and a Range
 * request — enough to read a signature, never the whole file. SERVER ONLY.
 * Shared by the work-order photo ingest (app/api/wo/photos) and the site
 * check-in photo ingest (app/api/wo/site-visits/photos): a signed upload URL
 * is permission to store bytes, never a statement of what they are.
 *
 * Tom, 30 Sep: this read went through the runtime's patched fetch and never
 * came back — the ingest sat after "auth" for ever and the painter saw
 * "Uploading…" with no end (C1 server log, 30 Sep). Node's own client,
 * untouched by the framework: ask for the first bytes, take what arrives,
 * drop the socket. A store that ignores Range answers 200 with the whole
 * body; only the first chunk is kept and the request is destroyed.
 */
export async function stagedHeadBytes(supabase: SupabaseClient, bucket: string, path: string, n = 64): Promise<Uint8Array | null> {
  const { data: signed, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !signed?.signedUrl) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: Uint8Array | null) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => { req.destroy(); finish(null); }, 8_000);
    const req = httpsGet(signed.signedUrl, { headers: { Range: `bytes=0-${n - 1}` } }, (res) => {
      if (!res.statusCode || res.statusCode >= 300) { res.resume(); clearTimeout(timer); return finish(null); }
      const chunks: Buffer[] = []; let got = 0;
      res.on("data", (c: Buffer) => {
        chunks.push(c); got += c.length;
        if (got >= n) { clearTimeout(timer); finish(new Uint8Array(Buffer.concat(chunks)).slice(0, n)); req.destroy(); }
      });
      res.on("end", () => { clearTimeout(timer); finish(got ? new Uint8Array(Buffer.concat(chunks)).slice(0, n) : null); });
      res.on("error", () => { clearTimeout(timer); finish(got ? new Uint8Array(Buffer.concat(chunks)).slice(0, n) : null); });
    });
    req.on("error", () => { clearTimeout(timer); finish(null); });
  });
}
