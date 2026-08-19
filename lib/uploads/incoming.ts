/**
 * A3: the signed-upload staging area. Big files (a 20 MB plan PDF, an iPhone
 * photo) cannot ride a multipart POST through the serverless function — the
 * platform caps request bodies at ~4.5 MB and refuses them with a non-JSON
 * error page the app can't even parse. So the client asks for a signed upload
 * URL, PUTs the bytes straight to storage, and then tells the process route
 * which staged objects to validate and ingest (magic bytes are still checked
 * server-side on the staged bytes — the R4/C5 rule holds; the stage path is
 * never trusted as a statement of content).
 */

/** Where a caller's staged uploads live. The user id in the path is the
 * ownership check — the process route refuses any path outside the caller's
 * own prefix. */
export function incomingPrefix(userId: string): string {
  return `incoming/${userId}/`;
}

export function makeIncomingPath(userId: string, index: number, stamp: string): string {
  return `${incomingPrefix(userId)}${stamp}-${index}`;
}

/**
 * True only for a clean path inside THIS caller's staging prefix. Refuses
 * traversal ("..", backslashes, absolute paths, double slashes) outright —
 * a crafted path must never reach a storage download call.
 */
export function isOwnIncomingPath(path: string, userId: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 400) return false;
  if (path.includes("..") || path.includes("\\") || path.includes("//")) return false;
  if (path.startsWith("/")) return false;
  if (!path.startsWith(incomingPrefix(userId))) return false;
  const rest = path.slice(incomingPrefix(userId).length);
  // One flat segment, conservative characters only.
  return /^[A-Za-z0-9._-]{1,120}$/.test(rest);
}
