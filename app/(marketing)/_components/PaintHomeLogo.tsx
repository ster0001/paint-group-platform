import { PAINT_HOME_LOGO } from "@/lib/marketing/paintHomeLogo";

/**
 * The Paint Home mark, inline (brief §3: vectors, never rasterised). `nav`
 * crops to the top row — wordmark and brush, no tagline; `full` is the
 * whole mark for the footer. `on` picks the text fill for the background
 * (the two supplied files differ only there). Server-safe: no hooks.
 */
export default function PaintHomeLogo({ variant = "nav", on = "dark", className, title = "Paint Home" }: {
  variant?: "nav" | "full"; on?: "dark" | "light"; className?: string; title?: string;
}) {
  const L = PAINT_HOME_LOGO;
  const text = L.text[on];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={variant === "nav" ? L.viewBoxNav : L.viewBoxFull} className={className} role="img" aria-label={title} data-testid={`painthome-logo-${variant}`}>
      <path fill={L.brush} fillRule="evenodd" d={L.paths.brush} />
      <path fill={text} fillRule="evenodd" d={L.paths.paint} />
      <path fill={L.home} fillRule="evenodd" d={L.paths.home} />
      {variant === "full" && <path fill={text} fillRule="evenodd" d={L.paths.tagline} />}
    </svg>
  );
}
