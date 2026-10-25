import { ImageResponse } from "next/og";
import { PAINT_HOME_LOGO } from "@/lib/marketing/paintHomeLogo";

/**
 * The Paint Home mark for LIGHT surfaces — the white estimate card the
 * customer reads at /e (Tom, 25 Oct 2026: "the estimate the client receives
 * has the Paint Home logo on it"). Transparent, ink-coloured lettering; the
 * same path data as every other rendering. The email mark stays
 * `/painthome/email-logo.png` (slate background, for dark-mode mail).
 */
export const dynamic = "force-static";

export async function GET() {
  const L = PAINT_HOME_LOGO;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent" }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox={L.viewBoxNav} width={440} height={116}>
          <path fill={L.brush} fillRule="evenodd" d={L.paths.brush} />
          <path fill={L.text.light} fillRule="evenodd" d={L.paths.paint} />
          <path fill={L.home} fillRule="evenodd" d={L.paths.home} />
        </svg>
      </div>
    ),
    { width: 440, height: 116 },
  );
}
