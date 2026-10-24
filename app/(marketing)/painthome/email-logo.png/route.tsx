import { ImageResponse } from "next/og";
import { PAINT_HOME_LOGO } from "@/lib/marketing/paintHomeLogo";
import { BRAND_DEFAULTS } from "@/lib/marketing/brand";

/**
 * The Paint Home mark for EMAILS (paint-home brief §5; lib/messaging/brand.ts):
 * a PNG that carries its own slate background, so dark-mode mail clients
 * cannot invert it (Tom, 24 Sep 2026 — the reason Settings has an email
 * logo). Drawn from the same path data as every other rendering of the mark.
 * Static; `.png` paths bypass the proxy, so it is served on every host.
 */
export const dynamic = "force-static";

export async function GET() {
  const L = PAINT_HOME_LOGO;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND_DEFAULTS.painthome.inkColour, borderRadius: 12 }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox={L.viewBoxNav} width={360} height={95}>
          <path fill={L.brush} fillRule="evenodd" d={L.paths.brush} />
          <path fill={L.text.dark} fillRule="evenodd" d={L.paths.paint} />
          <path fill={L.home} fillRule="evenodd" d={L.paths.home} />
        </svg>
      </div>
    ),
    { width: 440, height: 110 },
  );
}
