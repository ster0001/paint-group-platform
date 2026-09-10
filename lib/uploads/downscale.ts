/**
 * Browser-side photo downscale, shared by every screen that uploads a photo
 * for a SCREEN to show (the estimate's line photos, the showcase). A phone
 * photo is 3–6 MB at ~4000 px; nothing the customer or the office sees is
 * wider than ~2000 px, so the extra pixels are bytes on the wire and
 * nothing else — the upload takes a third of the time and the picture looks
 * identical. Photos that are EVIDENCE (a work order's site photos, sign-off)
 * do not come through here; they keep their originals.
 *
 * Returns null when the browser can't decode the file (HEIC on Chrome) —
 * the caller decides whether to send the original instead.
 */

/** Long-edge cap for a photo that is only ever viewed on a screen. */
export const SCREEN_MAX_EDGE = 2048;

export async function downscale(file: File, maxEdge: number, quality = 0.9): Promise<Blob | null> {
  const source = await decode(file);
  if (!source) return null;
  try {
    const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
    const w = Math.max(1, Math.round(source.width * scale));
    const h = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source.el, 0, 0, w, h);
    if ("close" in source.el) source.el.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  } catch {
    return null;
  }
}

type Decoded = { el: ImageBitmap | HTMLImageElement; width: number; height: number };

/** createImageBitmap first; an <img> as the fallback for browsers/formats it refuses. */
async function decode(file: File): Promise<Decoded | null> {
  try {
    const bmp = await createImageBitmap(file);
    return { el: bmp, width: bmp.width, height: bmp.height };
  } catch { /* fall through */ }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("undecodable"));
      el.src = url;
    });
    return { el: img, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
