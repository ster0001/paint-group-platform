/**
 * A3: iPhones shoot HEIC. The sniffer and the bucket accept it, but the
 * vision models only read JPEG/PNG/WEBP — so before this existed, a HEIC
 * floorplan uploaded "successfully" and then could never be read. Every HEIC
 * is converted to JPEG at ingest; the original is kept alongside, per the
 * keep-the-original rule.
 *
 * heic-convert is pure WASM (libheif) — no native binary, works on the
 * serverless platform. Imported dynamically so the module only loads when a
 * HEIC actually arrives.
 */

export type HeicResult =
  | { ok: true; jpeg: Uint8Array }
  | { ok: false; message: string };

export async function convertHeicToJpeg(bytes: Uint8Array): Promise<HeicResult> {
  try {
    const { default: convert } = await import("heic-convert");
    const out = await convert({ buffer: bytes, format: "JPEG", quality: 0.9 });
    return { ok: true, jpeg: new Uint8Array(out) };
  } catch {
    return {
      ok: false,
      message: "That iPhone photo couldn't be converted — take a screenshot of it and upload the screenshot instead.",
    };
  }
}
