import { ImageResponse } from "next/og";
import { PAINT_HOME_LOGO } from "@/lib/marketing/paintHomeLogo";
import { BRAND_DEFAULTS } from "@/lib/marketing/brand";

/**
 * Paint Home's OG image (brief §3): the full mark on the slate background,
 * 1200 × 630 — the one place the vector is rasterised. Drawn from the same
 * path data as the nav and footer, so it can never be a different logo.
 * Static per build (no data), served at /painthome/opengraph-image.
 */
export const alt = "Paint Home — Your qualified local painters";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const L = PAINT_HOME_LOGO;
  const ink = BRAND_DEFAULTS.painthome.inkColour;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(160deg, ${ink} 0%, ${ink} 55%, #4A4A50 100%)` }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox={L.viewBoxFull} width={960} height={253}>
          <path fill={L.brush} fillRule="evenodd" d={L.paths.brush} />
          <path fill={L.text.dark} fillRule="evenodd" d={L.paths.paint} />
          <path fill={L.home} fillRule="evenodd" d={L.paths.home} />
          <path fill={L.text.dark} fillRule="evenodd" d={L.paths.tagline} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
