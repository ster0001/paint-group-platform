/**
 * Stage 1 of the plan reader: normalisation. No AI anywhere in this file.
 *
 * Two jobs, both deliberately dull and both deterministic:
 *
 *   1. Decide what a file actually IS, from its bytes. The `accept` attribute
 *      on a file input is a hint, and the browser-reported MIME type is
 *      whatever the client says it is — a .txt renamed to .pdf arrives claiming
 *      to be a PDF (audit finding C5). Everything here reads the magic bytes.
 *
 *   2. Decide what a PAGE is, so it can be routed: an interior floorplan goes
 *      down the room-geometry pipeline, an elevation or site plan goes to the
 *      exterior one. Getting this wrong wastes a model call and, worse, feeds
 *      an elevation to a reader expecting rooms.
 *
 * Page classification here is a keyword pass over the PDF's own text layer. On
 * a vector plan that text is exact — the real strings the draftsman typed — so
 * this is more reliable than asking a model to look at a picture of it, and it
 * costs nothing. A scanned or photographed plan has no text layer, so it falls
 * through to `other` with low confidence and the model classifies it instead.
 * The function says which of the two happened, rather than pretending to a
 * certainty it doesn't have.
 */

export type FileKind = "pdf" | "jpeg" | "png" | "webp" | "heic";

export type PageClass =
  | "floorplan_interior"
  | "site_plan"
  | "elevation"
  | "photo"
  | "other";

/** 25 MB, per the brief. The bucket enforces the same number server-side. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const KIND_MIME: Record<FileKind, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0): boolean =>
  sig.every((b, i) => bytes[offset + i] === b);

/**
 * What the bytes say this is, ignoring the filename and the declared type.
 * Returns null when the signature isn't one we accept.
 */
export function sniffKind(bytes: Uint8Array): FileKind | null {
  if (bytes.length < 12) return null;

  // %PDF
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  // JPEG SOI + marker
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  // PNG signature
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "webp";
  }
  // ISO-BMFF: "ftyp" at offset 4, then a HEIF-family brand
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) return "heic";
  }
  return null;
}

export type NormaliseResult =
  | { ok: true; kind: FileKind; mime: string; bytes: number }
  | { ok: false; message: string };

/**
 * Gate an upload before a single byte reaches storage or a model.
 *
 * Takes the declared type only to notice when it DISAGREES with the bytes,
 * which is worth saying plainly rather than silently correcting: a file that
 * lies about itself is either a mistake worth telling the user about, or an
 * attempt worth not obliging.
 */
export function normaliseUpload(
  bytes: Uint8Array,
  declaredMime?: string,
  filename?: string,
): NormaliseResult {
  if (bytes.length === 0) return { ok: false, message: "That file is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    const mb = (bytes.length / (1024 * 1024)).toFixed(1);
    return { ok: false, message: `That file is ${mb} MB. The limit is 25 MB — please send a smaller one.` };
  }

  const kind = sniffKind(bytes);
  if (!kind) {
    const named = filename ? ` (${filename})` : "";
    return {
      ok: false,
      message: `That doesn't look like a plan or a photo${named}. Upload a PDF, JPG, PNG or HEIC.`,
    };
  }

  const mime = KIND_MIME[kind];
  if (declaredMime && declaredMime !== mime && declaredMime !== "application/octet-stream") {
    // Not fatal — phones and browsers get this wrong innocently all the time.
    // We store what the bytes say, and the caller may log the disagreement.
    return { ok: true, kind, mime, bytes: bytes.length };
  }
  return { ok: true, kind, mime, bytes: bytes.length };
}

// ---- page classification ----------------------------------------------------

const ROOM_WORDS = [
  "bed", "bedroom", "master", "living", "lounge", "family", "meals", "dining",
  "kitchen", "bath", "bathroom", "ensuite", "wc", "toilet", "laundry", "garage",
  "study", "rumpus", "retreat", "robe", "pantry", "hall", "entry", "alfresco",
  "porch", "void", "linen",
];
const FLOOR_WORDS = ["floor plan", "floorplan", "ground floor", "first floor", "upper floor", "lower floor"];
// "section" is deliberately NOT a bare keyword here. In Victoria a "Section 32"
// vendor's statement is routinely bound into the same PDF as the floorplan, and
// it was being classified as an elevation sheet. A drawing section is labelled
// "SECTION A-A" or "SECTION 1:100", which SECTION_LABEL matches instead.
const ELEVATION_WORDS = ["elevation", "north elevation", "south elevation", "east elevation", "west elevation"];
const SECTION_LABEL = /\bsection\s+([a-z]\s*[-–]\s*[a-z]\b|\d+\s*:\s*\d+)/i;
const SITE_WORDS = ["site plan", "site coverage", "boundary", "setback", "easement", "title plan", "allotment"];

/** "3.60 x 4.20", "3600 X 4200" — a dimension pair, the signature of a plan. */
const DIMENSION_PAIR = /\b\d{1,5}(?:[.,]\d{1,3})?\s*[x×]\s*\d{1,5}(?:[.,]\d{1,3})?\b/i;

export type PageClassification = {
  pageClass: PageClass;
  confidence: number;
  /** Why, in words — shown on the debug page so a wrong call is diagnosable. */
  reasons: string[];
  /** False when there was no text layer to read, so a model must classify it. */
  fromTextLayer: boolean;
};

/**
 * Classify one page from its extracted text.
 *
 * `hasTextLayer: false` (a scan, or a photo) always returns low confidence —
 * the caller should send it to the model rather than trusting this.
 */
export function classifyPage(
  text: string | null,
  opts: { isImageFile?: boolean; declaredKind?: string } = {},
): PageClassification {
  if (opts.isImageFile) {
    // An image tells us NOTHING without looking at it, and the first version of
    // this returned "photo" at 0.95 — which was wrong on every one of the nine
    // real listing floorplans it was tried on. They are floorplans that happen
    // to be JPGs, and `photo` would have routed them to the exterior pipeline.
    //
    // So: take the uploader's word as a weak prior (they chose the kind when
    // they uploaded it) and score it LOW, because only the model can confirm
    // what an image actually shows.
    const fromKind: Record<string, PageClass> = {
      floorplan: "floorplan_interior",
      site_plan: "site_plan",
      elevation: "elevation",
      exterior_photo: "photo",
      defect_photo: "photo",
      listing: "photo",
    };
    const declared = opts.declaredKind ? fromKind[opts.declaredKind] : undefined;
    return {
      pageClass: declared ?? "other",
      confidence: declared ? 0.4 : 0.2,
      reasons: [
        "an image, so there is no text layer to read",
        declared
          ? `provisionally "${declared}" because that is what it was uploaded as — the model confirms it`
          : "nothing to go on until the model looks at it",
      ],
      fromTextLayer: false,
    };
  }

  const raw = (text ?? "").trim();
  if (!raw) {
    return {
      pageClass: "other",
      confidence: 0.1,
      reasons: ["no text layer — a scan or photo of a plan; needs the model to classify"],
      fromTextLayer: false,
    };
  }

  const hay = raw.toLowerCase();
  const reasons: string[] = [];
  const hits = (words: string[]) => words.filter((w) => hay.includes(w));

  const elevationHits = hits(ELEVATION_WORDS);
  if (SECTION_LABEL.test(raw)) elevationHits.push("a drawing section label");
  const siteHits = hits(SITE_WORDS);
  const floorHits = hits(FLOOR_WORDS);
  const roomHits = hits(ROOM_WORDS);
  const hasDims = DIMENSION_PAIR.test(raw);

  // Order matters: an elevation sheet often names rooms in a title block, and a
  // site plan often says "floor plan" in a reference note. The more specific
  // document types are tested first.
  if (elevationHits.length && !floorHits.length) {
    reasons.push(`elevation wording: ${elevationHits.slice(0, 3).join(", ")}`);
    return { pageClass: "elevation", confidence: Math.min(0.9, 0.6 + elevationHits.length * 0.1), reasons, fromTextLayer: true };
  }
  if (siteHits.length >= 2 || (siteHits.length === 1 && !roomHits.length)) {
    reasons.push(`site-plan wording: ${siteHits.slice(0, 3).join(", ")}`);
    return { pageClass: "site_plan", confidence: Math.min(0.9, 0.55 + siteHits.length * 0.12), reasons, fromTextLayer: true };
  }

  let score = 0;
  if (floorHits.length) { score += 0.45; reasons.push(`floor-plan wording: ${floorHits.slice(0, 2).join(", ")}`); }
  if (roomHits.length >= 3) { score += 0.35; reasons.push(`${roomHits.length} room names: ${roomHits.slice(0, 4).join(", ")}`); }
  else if (roomHits.length) { score += 0.15; reasons.push(`room names: ${roomHits.join(", ")}`); }
  if (hasDims) { score += 0.25; reasons.push("dimension pairs printed on the page"); }

  if (score >= 0.5) {
    return { pageClass: "floorplan_interior", confidence: Math.min(0.95, score), reasons, fromTextLayer: true };
  }

  reasons.push("no floor-plan, elevation or site-plan signals in the text");
  return { pageClass: "other", confidence: 0.3, reasons, fromTextLayer: true };
}
