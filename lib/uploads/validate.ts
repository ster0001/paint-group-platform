/**
 * What a file has to be before it may be uploaded.
 *
 * The real enforcement is on the bucket itself (`file_size_limit` and
 * `allowed_mime_types`, set in migration 20260905000000) — Supabase Storage
 * refuses anything outside those, so this module cannot be the only guard and
 * is not written as if it were. What it adds is a plain-English refusal BEFORE
 * a painter pushes 800 MB up a phone connection only to be told "400".
 *
 * Both layers read from the same table below, so they can't drift apart in
 * spirit: change a rule here and change the migration in the same commit.
 */

export type UploadKind = "image" | "document" | "video";

const MB = 1024 * 1024;

/** Extensions we accept, and the type each one really is. */
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

const IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
];

// SVG is deliberately absent from every list: it is a script container, and
// these buckets are served from a Supabase origin we don't want executing
// anything.
export const UPLOAD_RULES: Record<UploadKind, { maxBytes: number; mimes: string[]; wording: string }> = {
  image: {
    maxBytes: 10 * MB,
    mimes: IMAGE_MIMES,
    wording: "a photo (JPG, PNG, WEBP, GIF or HEIC)",
  },
  document: {
    // A certificate is usually a PDF, but a photo of one is just as good.
    maxBytes: 15 * MB,
    mimes: ["application/pdf", ...IMAGE_MIMES],
    wording: "a PDF or a photo (JPG, PNG, WEBP or HEIC)",
  },
  video: {
    maxBytes: 200 * MB,
    mimes: ["video/mp4", "video/webm", "video/quicktime"],
    wording: "an MP4, WEBM or MOV video",
  },
};

/** `accept=` for the file input. A UI hint only — never a control. */
export function acceptAttr(kind: UploadKind): string {
  return UPLOAD_RULES[kind].mimes.join(",");
}

function humanSize(bytes: number): string {
  return bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The type the browser claims, falling back to the extension when it says nothing. */
function typeOf(file: { name: string; type?: string }): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "";
}

/**
 * Returns a message to show the user, or null when the file is acceptable.
 *
 * Takes the fields it needs rather than a `File` so it can be unit-tested and
 * called from server code.
 */
export function checkUpload(
  file: { name: string; size: number; type?: string },
  kind: UploadKind,
): string | null {
  const rule = UPLOAD_RULES[kind];

  if (file.size === 0) return "That file is empty — check it saved properly and try again.";
  if (file.size > rule.maxBytes) {
    return `That file is ${humanSize(file.size)}. The limit is ${humanSize(rule.maxBytes)} — please send a smaller one.`;
  }

  const mime = typeOf(file);
  if (!mime) return `We couldn't tell what kind of file that is. Please upload ${rule.wording}.`;
  if (!rule.mimes.includes(mime)) return `That's not a file we can use here. Please upload ${rule.wording}.`;

  return null;
}
