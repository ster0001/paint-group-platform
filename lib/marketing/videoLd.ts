/**
 * The ONE VideoObject builder (Search Console, 28 Oct 2026: "Missing field
 * uploadDate" on painthome.com.au — a critical issue that keeps the page out
 * of video results). Every video the sites mark up — the homepage's featured
 * video, whether a showcase job's or one pasted into Settings, and the job
 * page's — goes through here, so a required field cannot be forgotten twice.
 * `uploadDate` is required by Google and always set: the day the video was
 * added or published, else the job's completion day, else the row's creation.
 */
export type VideoLdInput = {
  name: string;
  description: string;
  thumbnailUrl: Array<string | null | undefined>;
  embedUrl: string;
  contentUrl: string;
  transcript?: string | null;
  uploadDate: string;
};

export function videoObjectLd(i: VideoLdInput) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: i.name,
    description: i.description,
    thumbnailUrl: i.thumbnailUrl.filter((u): u is string => typeof u === "string" && u.length > 0),
    uploadDate: i.uploadDate,
    embedUrl: i.embedUrl,
    contentUrl: i.contentUrl,
    ...(i.transcript ? { transcript: i.transcript } : {}),
  };
}

/** A calendar day in Melbourne (never the UTC day — before 10am it is yesterday). */
export function melbourneDay(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A showcase job's upload date: published, else completed, else created; the day part of an ISO stamp. */
export function videoUploadDateFor(job: { published_at?: string | null; completed_on?: string | null; created_at?: string | null }, fallback: Date = new Date()): string {
  const pick = job.published_at || job.completed_on || job.created_at || "";
  const day = pick.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : melbourneDay(fallback);
}
