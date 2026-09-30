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
 * Tom, 30 Sep: "photos just get stuck on 'Uploading…'". Nothing here had a
 * timeout, so a request that never answered (a dead session, a PUT stalled
 * on one bar of signal) sat on "Uploading…" for ever with no message. Now:
 *
 *   · every step has a deadline and says which one it missed;
 *   · the storage PUT reports progress (the card shows a percentage) and
 *     gives up after 45 s with NO bytes moving, not after a fixed clock;
 *   · a big photo is shrunk on the phone first (long edge 2000 px, JPEG) —
 *     a 15 MB HEIC over cellular was most of the "stuck". A file the phone
 *     cannot decode goes as it is.
 *
 * Client-safe: fetch/XHR only. The server decides everything that matters.
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
  /** 0–1 through the storage step; the card shows it. */
  onProgress?: (fraction: number) => void;
};

/** Deadlines, in ms. The store step is a STALL timer: it resets on every byte. */
export const UPLOAD_DEADLINES = { sign: 20_000, storeStall: 45_000, storeTotal: 10 * 60_000, ingest: 30_000 } as const;
/** Photos above this are shrunk on the phone before they go. */
export const SHRINK_ABOVE_BYTES = 1_500_000;
export const SHRINK_LONG_EDGE_PX = 2000;

export class UploadError extends Error {
  constructor(message: string, readonly stage: "sign" | "store" | "ingest", readonly timedOut = false) { super(message); }
}

/** fetch with a deadline; a miss throws UploadError(timedOut) naming the step. */
async function fetchWithDeadline(url: string, init: RequestInit, ms: number, stage: "sign" | "ingest"): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new UploadError(stage === "sign"
      ? "The server didn't answer in time — check your signal, or sign out and back in, then try again."
      : "The file uploaded but the server didn't answer in time — try once more; a repeat is harmless.", stage, true);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/**
 * The storage PUT through XMLHttpRequest — the one browser API that reports
 * UPLOAD progress. Gives up when no byte has moved for `storeStall` ms, or
 * after `storeTotal` regardless.
 */
function putWithProgress(url: string, body: Blob, type: string, onProgress?: (f: number) => void): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stall: ReturnType<typeof setTimeout> | null = null;
    const total = setTimeout(() => { xhr.abort(); reject(new UploadError(`That upload has been going for ${Math.round(UPLOAD_DEADLINES.storeTotal / 60_000)} minutes — try a smaller photo, or better signal.`, "store", true)); }, UPLOAD_DEADLINES.storeTotal);
    const armStall = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => { xhr.abort(); reject(new UploadError("The upload stalled — nothing moved for 45 seconds. Check your signal and try again.", "store", true)); }, UPLOAD_DEADLINES.storeStall);
    };
    const done = () => { clearTimeout(total); if (stall) clearTimeout(stall); };
    xhr.upload.onprogress = (e) => { armStall(); if (e.lengthComputable && onProgress) onProgress(Math.max(0, Math.min(1, e.loaded / e.total))); };
    xhr.onload = () => { done(); resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText }); };
    xhr.onerror = () => { done(); reject(new UploadError("The upload didn't reach the photo store — check your signal and try again.", "store")); };
    xhr.onabort = () => { done(); };
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", type);
    armStall();
    xhr.send(body);
  });
}

/** True when a photo is worth shrinking before it goes: an image over the size line. */
export function shouldShrink(file: Pick<File, "type" | "name" | "size">): boolean {
  return !isVideoFile(file) && file.size > SHRINK_ABOVE_BYTES;
}

/** The output size for a long edge cap — never upscales. */
export function fitWithin(width: number, height: number, longEdge = SHRINK_LONG_EDGE_PX): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= longEdge) return { width, height };
  const k = longEdge / longest;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/**
 * Shrink on the phone: decode, draw at ≤ 2000 px, re-encode as JPEG 0.85.
 * Anything the browser cannot decode (an HEIC on a phone that can't) comes
 * back untouched, so nothing is ever lost — only never made smaller.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (typeof window === "undefined" || !shouldShrink(file)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
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

async function storageMessage(res: { status: number; text: string }, type: string, size: number): Promise<string> {
  const mb = (size / (1024 * 1024)).toFixed(1);
  let detail = "";
  try {
    const body = JSON.parse(res.text) as { message?: string; error?: string };
    detail = String(body.message ?? body.error ?? "");
  } catch { /* not JSON */ }
  if (/mime|content-type|not supported/i.test(detail)) return `The photo store won't take a ${type} file. Try a JPEG or an MP4.`;
  if (/size|too large|exceed/i.test(detail) || res.status === 413) return `That file is ${mb} MB — too big for the photo store.`;
  if (res.status === 403 || /policy|permission|row-level/i.test(detail)) return "The photo store refused this job's folder — reload the page and try again, or tell the office.";
  return detail ? `The photo store said: ${detail}` : `The photo store refused the upload (HTTP ${res.status}).`;
}

/** Sign, store, ingest. Resolves to the new wo_photos row id; throws UploadError with a message a painter can read. */
export async function uploadWorkOrderMedia(input: UploadInput): Promise<{ id: string }> {
  const file = await shrinkImage(input.file);
  const type = declaredType(file);
  input.onProgress?.(0);

  const signRes = await fetchWithDeadline("/api/wo/photos", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workOrderId: input.workOrderId, size: file.size, contentType: type }),
  }, UPLOAD_DEADLINES.sign, "sign");
  const sign = (await signRes.json().catch(() => ({}))) as { path?: string; token?: string; error?: string };
  if (!signRes.ok || !sign.path || !sign.token) throw new UploadError(sign.error ?? "Couldn't get the upload ready — try again in a moment.", "sign");

  const put = await putWithProgress(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/wo-photos/${sign.path}?token=${sign.token}`,
    file, type, input.onProgress,
  );
  if (!put.ok) throw new UploadError(await storageMessage(put, type, file.size), "store");
  input.onProgress?.(1);

  const ingest = await fetchWithDeadline("/api/wo/photos", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workOrderId: input.workOrderId, path: sign.path, kind: input.kind,
      area: input.area ?? "", caption: input.caption ?? "",
      surfaceId: input.surfaceId ?? undefined, variationId: input.variationId ?? undefined,
    }),
  }, UPLOAD_DEADLINES.ingest, "ingest");
  const done = (await ingest.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!ingest.ok || !done.id) throw new UploadError(done.error ?? "The file uploaded but we couldn't file it — try again.", "ingest");
  return { id: done.id };
}

/** "Uploading… 42%" — the button's text while a file is on its way. */
export function uploadingLabel(fraction: number | null | undefined): string {
  if (fraction == null || fraction <= 0) return "Uploading…";
  if (fraction >= 1) return "Uploading… filing it";
  return `Uploading… ${Math.round(fraction * 100)}%`;
}

/** The line a card shows when an upload throws. */
export function uploadFailureText(e: unknown, file: Pick<File, "type" | "name">): string {
  if (e instanceof UploadError) return e.message;
  return `That ${isVideoFile(file) ? "video" : "photo"} didn't upload — check your signal and try again.`;
}
