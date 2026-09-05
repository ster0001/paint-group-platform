import { headers } from "next/headers";
import { AUDIENCE_HEADER, isAudience, type Audience } from "./audience";

// SERVER ONLY. The proxy stamps x-audience on every request (lib/marketing/
// audience.ts); pages outside the two homepage routes (the /work pages, the
// sitemap) read it here. Reading headers makes the page dynamic, which is
// why the homepages themselves are two static routes instead.
export async function getAudience(): Promise<Audience> {
  const h = await headers();
  const v = h.get(AUDIENCE_HEADER);
  return isAudience(v) ? v : "home";
}
