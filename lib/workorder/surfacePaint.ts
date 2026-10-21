import type { WOSurface } from "./snapshot";

/**
 * The paint a substrate is painted in, in the painter's words — ONE line per
 * surface on the job sheet (Tom, 21 Oct 2026: "add the paint for each
 * substrate in the work orders for the contractors — currently it is only
 * something we see, not them"). The frozen surface already carries the
 * product, the sheen and the resolved colour; the sheet used to print the
 * bare product in the small-print under the name and nothing else.
 *
 * "Dulux Wash&Wear · Low Sheen · Natural White"; a colour not yet chosen says
 * "Colour to be confirmed" in the same words the Materials section uses, so
 * the painter reads one phrase for one state. Null for a line with no paint
 * (an allowance, a pass-through) — those print no paint line at all.
 */
export function paintLabel(s: Pick<WOSurface, "product" | "finish" | "colourName">): string | null {
  const product = (s.product ?? "").trim();
  if (!product) return null;
  const parts = [product];
  const finish = (s.finish ?? "").trim();
  if (finish) parts.push(finish);
  const colour = (s.colourName ?? "").trim();
  parts.push(colour || "Colour to be confirmed");
  return parts.join(" · ");
}
