import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { MEDIA_TYPES, mediaPathFor } from "@/lib/help/content";
import { helpReader } from "@/lib/help/session";

/**
 * The one door to docs/help/**\/media. Serves only files the index lists for a
 * guide the caller's role may read; everything else is 404, including files
 * that exist for another role. No directory listing, no path building from
 * the request beyond the two validated segments.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ feature: string; file: string }> }) {
  const { feature, file } = await ctx.params;
  const reader = await helpReader();
  if (!reader) return new NextResponse("Not found", { status: 404 });
  const path = mediaPathFor(feature, file, reader.roles);
  if (!path) return new NextResponse("Not found", { status: 404 });
  const ext = file.split(".").pop() ?? "";
  const body = readFileSync(path);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": MEDIA_TYPES[ext] ?? "application/octet-stream",
      // Private to the reader's session; a day is plenty for screenshots that
      // only change with a deploy.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
