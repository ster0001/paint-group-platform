import { ImageResponse } from "next/og";
import { PAINT_HOME_LOGO } from "@/lib/marketing/paintHomeLogo";
import { BRAND_DEFAULTS } from "@/lib/marketing/brand";

/**
 * Paint Home's favicon (brief §3): the brush from the mark on a slate
 * tile, 64 × 64, from the same path data as the logo. Next links it from
 * every page under /painthome — which, on painthome.com.au, is the root.
 */
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  const L = PAINT_HOME_LOGO;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND_DEFAULTS.painthome.inkColour, borderRadius: 14 }}>
        {/* The brush sits in the mark's first 220 × 221 units. */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 221 221" width={52} height={52}>
          <path fill={L.brush} fillRule="evenodd" d={L.paths.brush} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
