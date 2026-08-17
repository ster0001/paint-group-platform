import { classifyPage, type PageClassification } from "./normalise";

// SERVER ONLY. mupdf is a multi-megabyte WASM module — importing this from a
// Client Component would ship it to the browser. Same convention as
// lib/contractor/session.ts: the pure, shared pieces live in ./normalise.

/**
 * PDF rasterisation and text extraction.
 *
 * mupdf is a WebAssembly build, which is why it was chosen over poppler
 * (`pdftoppm`) or anything needing a native canvas: there is no system binary
 * to install and it runs unchanged on Vercel's serverless runtime, where the
 * app is deployed.
 *
 * TWO renditions per page, per the brief:
 *   - a downscaled one for layout reasoning
 *   - the full-resolution one for dimension-text legibility
 * Small dimension text is the single biggest source of read errors, so the
 * downscaled image is never the only thing sent.
 *
 * The text layer matters more than either. On a vector plan, mupdf returns the
 * exact strings the draftsman typed — "3.60 x 4.20" as characters, not pixels
 * to be read. When it is present the geometry can be parsed rather than
 * guessed, and the model's job shrinks to layout and symbols.
 */

export const RENDER_DPI = 200;
export const THUMB_DPI = 72;

export type RenderedPage = {
  pageNo: number;
  /** Full-resolution PNG at RENDER_DPI — for dimension text. */
  png: Uint8Array;
  /** Downscaled PNG — for layout reasoning and the debug page. */
  thumbPng: Uint8Array;
  widthPx: number;
  heightPx: number;
  /** Exact text from a vector PDF; empty string for a scan. */
  text: string;
  classification: PageClassification;
};

export type PdfReadResult =
  | { ok: true; pageCount: number; pages: RenderedPage[] }
  | { ok: false; message: string };

/** Guardrail: a 60-page vendor's statement is not a plan set worth rendering. */
export const MAX_PAGES = 20;

export async function readPdf(bytes: Uint8Array, opts: { maxPages?: number } = {}): Promise<PdfReadResult> {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const mupdfModule = await import("mupdf");
  const mupdf = (mupdfModule as unknown as { default?: typeof mupdfModule }).default ?? mupdfModule;

  let doc: ReturnType<typeof mupdf.Document.openDocument>;
  try {
    doc = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch {
    return { ok: false, message: "That PDF couldn't be opened. If it's password-protected, save an unlocked copy and try again." };
  }

  try {
    if (doc.needsPassword?.()) {
      return { ok: false, message: "That PDF is password-protected. Save an unlocked copy and upload that." };
    }
  } catch {
    // Older builds don't expose needsPassword; openDocument would have thrown.
  }

  const pageCount = doc.countPages();
  if (pageCount === 0) return { ok: false, message: "That PDF has no pages." };

  const pages: RenderedPage[] = [];
  const limit = Math.min(pageCount, maxPages);

  for (let i = 0; i < limit; i++) {
    const page = doc.loadPage(i);

    let text = "";
    try {
      text = page.toStructuredText().asText().trim();
    } catch {
      // A scan has no text layer. Not an error — it just means the classifier
      // and the model have to work from the image.
    }

    const full = page.toPixmap(
      mupdf.Matrix.scale(RENDER_DPI / 72, RENDER_DPI / 72),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    );
    const thumb = page.toPixmap(
      mupdf.Matrix.scale(THUMB_DPI / 72, THUMB_DPI / 72),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    );

    pages.push({
      pageNo: i + 1,
      png: full.asPNG(),
      thumbPng: thumb.asPNG(),
      widthPx: full.getWidth(),
      heightPx: full.getHeight(),
      text,
      classification: classifyPage(text),
    });
  }

  return { ok: true, pageCount, pages };
}
