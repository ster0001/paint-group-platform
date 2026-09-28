/**
 * ONE upload path for a work-order photo or video, from any screen (Tom,
 * 28 Sep 2026 — "contractors haven't been able to attach the after photos …
 * an error message when trying to load the photos"). Four cards had their own
 * copy of sign → PUT → ingest, each swallowing the storage reply into "check
 * your signal". Now:
 *
 *   · the file's type is DECLARED to storage explicitly. A phone hands over a
 *     File with an empty `type` more often than you would think (HEIC on
 *     some Androids, a share-sheet copy); the bucket then sees no
 *     content-type, refuses it, and the painter sees "didn't upload". The
 *     extension fills the gap, and a photo with neither is sent as JPEG —
 *     the ingest still reads the real bytes;
 *   · a storage refusal is read back and said plainly (the file type or size
 *     it objected to), and the server's own message always reaches the card;
 *   · the sign step is told the type so a video is named as one.
 *
 * Client-safe: fetch only. The server decides everything that matters.
 */
export type UploadKind = "before" | "progress" | "qa" | "completion" | "variation" | "reference";

export type UploadInput = {
  workOrderId: string;
  file: File;
  kind: UploadKind;
  area?: string;
  caption?: string;
  surfaceId?: string | null;
  variationId?: string | null;
};

export class UploadError extends Error {
  constructor(message: string, readonly stage: "sign" | "store" | "ingest") { super(message); }
}

const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm",
};

/** The type to declare: the browser's, else the extension's, else JPEG (a photo with no name to go on). */
export function declaredType(file: Pick<File, "type" | "name">): string {
  const t = (file.type || "").toLowerCase();
  if (t && t !== "application/octet-stream") return t;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return BY_EXTENSION[ext] ?? "image/jpeg";
}

export const isVideoFile = (file: Pick<File, "type" | "name">) => declaredType(file).startsWith("video/");

async function storageMessage(res: Response, type: string, size: number): Promise<string> {
  const mb = (size / (1024 * 1024)).toFixed(1);
  let detail = "";
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    detail = String(body.message ?? body.error ?? "");
  } catch { /* not JSON */ }
  if (/mime|content-type|not supported/i.test(detail)) return `The photo store won't take a ${type} file. Try a JPEG or an MP4.`;
  if (/size|too large|exceed/i.test(detail) || res.status === 413) return `That file is ${mb} MB — too big for the photo store.`;
  if (res.status === 403 || /policy|permission|row-level/i.test(detail)) return "The photo store refused this job's folder — reload the page and try again, or tell the office.";
  return detail ? `The photo store said: ${detail}` : `The photo store refused the upload (HTTP ${res.status}).`;
}

/** Sign, store, ingest. Resolves to the new wo_photos row id; throws UploadError with a message a painter can read. */
export async function uploadWorkOrderMedia(input: UploadInput): Promise<{ id: string }> {
  const type = declaredType(input.file);

  const signRes = await fetch("/api/wo/photos", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workOrderId: input.workOrderId, size: input.file.size, contentType: type }),
  });
  const sign = (await signRes.json().catch(() => ({}))) as { path?: string; token?: string; error?: string };
  if (!signRes.ok || !sign.path || !sign.token) throw new UploadError(sign.error ?? "Couldn't get the upload ready — try again in a moment.", "sign");

  const put = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/wo-photos/${sign.path}?token=${sign.token}`,
    { method: "PUT", body: input.file, headers: { "Content-Type": type } },
  );
  if (!put.ok) throw new UploadError(await storageMessage(put, type, input.file.size), "store");

  const ingest = await fetch("/api/wo/photos", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workOrderId: input.workOrderId, path: sign.path, kind: input.kind,
      area: input.area ?? "", caption: input.caption ?? "",
      surfaceId: input.surfaceId ?? undefined, variationId: input.variationId ?? undefined,
    }),
  });
  const done = (await ingest.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!ingest.ok || !done.id) throw new UploadError(done.error ?? "The file uploaded but we couldn't file it — try again.", "ingest");
  return { id: done.id };
}

/** The line a card shows when an upload throws. */
export function uploadFailureText(e: unknown, file: Pick<File, "type" | "name">): string {
  if (e instanceof UploadError) return e.message;
  return `That ${isVideoFile(file) ? "video" : "photo"} didn't upload — check your signal and try again.`;
}
