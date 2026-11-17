import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAudience } from "@/lib/marketing/audienceServer";
import { brandKeyOf, BRAND_DEFAULTS } from "@/lib/marketing/brand";
import { SUCCESS_MOMENTS, isSuccessMoment, safeBack } from "@/lib/marketing/success";
import { adTagIdsFor } from "@/lib/marketing/adTags";
import ThanksClient from "./ThanksClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * /thanks/<moment> — the success URLs for paid marketing (Tom, 17 Nov 2026;
 * lib/marketing/success.ts). An unknown moment is a 404. `back` is a path on
 * this site only; `bg=1` is the hidden-frame visit (nothing to show, no return).
 */
export default async function ThanksPage({ params, searchParams }: { params: Promise<{ moment: string }>; searchParams: Promise<{ back?: string; bg?: string }> }) {
  const { moment } = await params;
  if (!isSuccessMoment(moment)) notFound();
  const { back, bg } = await searchParams;
  const audience = await getAudience();
  const brand = BRAND_DEFAULTS[brandKeyOf(audience)];
  const copy = SUCCESS_MOMENTS[moment];
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f7f5f1", fontFamily: "system-ui, sans-serif" }} data-testid={`thanks-${moment}`}>
      <ThanksClient moment={moment} back={safeBack(back)} background={bg === "1"} tags={adTagIdsFor(audience)} brandName={brand.name} title={copy.title} line={copy.line} phoneTel={brand.phoneTel} />
    </main>
  );
}
