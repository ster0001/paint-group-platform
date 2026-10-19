/**
 * Is this media URL (or storage path) a video?
 *
 * ONE answer for every surface that shows customer or office media — the
 * estimate's area photos (public estimate-media URLs, frozen into the
 * snapshot), the work-order sheet's scope photos and the painter's private
 * wo-photos paths. A video is told apart by its extension: the uploaders name
 * a video object `.mp4` / `.mov` / `.webm` / `.m4v` and photos keep an image
 * extension (or none at all on the work order), so the name is the record and
 * no row or field has to say "video".
 *
 * Tom, 19 Oct 2026: "we are getting a lot of videos from clients which we
 * want to forward on from whatsapp" — first onto the painter's job sheet, then
 * "make sure vids can be added in the estimate".
 */
export const VIDEO_EXTENSIONS: readonly string[] = ["mp4", "mov", "webm", "m4v"];

const VIDEO_RE = /\.(mp4|mov|webm|m4v)$/i;

export function isVideoUrl(urlOrPath: string): boolean {
  // A public URL may carry a query or a hash; the extension is on the path.
  const end = urlOrPath.search(/[?#]/);
  const path = end === -1 ? urlOrPath : urlOrPath.slice(0, end);
  return VIDEO_RE.test(path);
}

/** The images only — for a surface that cannot play a video (a PDF, a printed sheet, a demo phone). */
export function imagesOnly(urls: readonly string[]): string[] {
  return urls.filter((u) => !isVideoUrl(u));
}

/** The file extension a video upload should carry, from its declared type. */
export function videoExtensionForMime(mime: string | null | undefined): string | null {
  switch ((mime ?? "").toLowerCase()) {
    case "video/mp4": return "mp4";
    case "video/quicktime": return "mov";
    case "video/webm": return "webm";
    case "video/x-m4v": return "m4v";
    default: return null;
  }
}
