import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getAudience } from "@/lib/marketing/audienceServer";
import { audiencePrefix, commercialDomain, otherAudienceHref, residentialOrigin } from "@/lib/marketing/audience";
import { getSiteLogo } from "@/lib/marketing/siteContent";
import Nav from "../../_sections/Nav";
import Footer from "../../_sections/Footer";
import CallBar from "../../_sections/CallBar";
import ProjectPage from "../../_components/ProjectPage";
import { publishedShowcaseJobs, relatedShowcaseJobs, showcaseJobBySlug } from "@/lib/showcase/queries";
import { formatPriceRange, showcaseMediaUrl } from "@/lib/showcase/format";
import { parseVideoUrl } from "@/lib/marketing/video";

/**
 * /work/[slug] — one showcase job through THE template (brief §4.4c).
 * Statically generated with ISR: every published slug is built ahead,
 * unknown slugs render on demand, unpublished ones 404, and the save action
 * revalidates the path so an edit is live within a minute.
 */
// Session 8: a project page 301s to the domain matching its property_type,
// which needs the request's host — so it renders per request (no ISR, no
// prerendered params). One row and its related jobs.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const job = await showcaseJobBySlug(slug);
  if (!job) return { title: "Job not found | Paint Group" };
  const price = job.price_low_cents != null && job.price_high_cents != null ? formatPriceRange(job.price_low_cents, job.price_high_cents) : "";
  const title = `${job.title} in ${job.suburb}${price ? `, ${price}` : ""} | Paint Group`;
  const description = job.summary || job.scope_line || `${job.title} in ${job.suburb}, painted by Paint Group.`;
  return {
    title,
    description,
    openGraph: {
      title, description, type: "article",
      images: job.hero_path ? [{ url: showcaseMediaUrl(job.hero_path), alt: `${job.title} in ${job.suburb}` }] : [],
    },
  };
}

export default async function WorkJobPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = await showcaseJobBySlug(slug);
  if (!job) notFound();
  // Session 8 §7: a project page lives on the domain matching its
  // property_type; the other domain 301s to it (no URL answers on both).
  const audience = await getAudience();
  const domain = commercialDomain();
  if (domain) {
    const residential = residentialOrigin() ?? "";
    if (job.property_type === "business" && audience === "home") permanentRedirect(`https://${domain}/work/${job.slug}`);
    if (job.property_type === "home" && audience === "business" && residential) permanentRedirect(`${residential}/work/${job.slug}`);
  }
  const prefix = audiencePrefix(audience);
  const [all, logoUrl] = await Promise.all([publishedShowcaseJobs(), getSiteLogo()]);
  const related = relatedShowcaseJobs(all, job);

  // Article JSON-LD — deliberately no Product/Offer markup: prices are ranges
  // for a finished job, not an offer (§4.4c).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${job.title} in ${job.suburb}`,
    description: job.summary || job.scope_line,
    image: job.hero_path ? [showcaseMediaUrl(job.hero_path)] : undefined,
    datePublished: job.published_at ?? undefined,
    dateModified: job.updated_at || undefined,
    author: { "@type": "Organization", name: "Paint Group" },
    publisher: { "@type": "Organization", name: "Paint Group" },
  };

  // VideoObject when the job carries a video (Tom, 5 Sep): name, description,
  // thumbnail, upload date (the job's publish date), the privacy-enhanced embed
  // URL and the transcript — so the video is indexable text as well.
  const video = job.video_url ? parseVideoUrl(job.video_url) : null;
  const videoLd = video ? {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: job.video_caption || `${job.title} in ${job.suburb}`,
    description: job.review_quote || job.summary || job.scope_line,
    thumbnailUrl: [job.video_poster_path ? showcaseMediaUrl(job.video_poster_path) : video.thumbnailUrl].filter(Boolean),
    uploadDate: job.published_at ?? undefined,
    embedUrl: video.embedUrl,
    contentUrl: video.watchUrl,
    transcript: job.video_transcript || undefined,
  } : null;

  return (
    <>
      <Nav logoUrl={logoUrl} copy={{ links: [{ label: "Real jobs, real prices", href: "/work" }, { label: "How it works", href: "/#how" }, { label: "Reviews", href: "/#reviews" }], otherLabel: audience === "home" ? "For business →" : "For homes →", otherHref: otherAudienceHref(audience), cta: "See my price", prefix }} />
      <main data-audience={audience}>
        <ProjectPage job={job} related={related} />
      </main>
      <Footer />
      <CallBar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {videoLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(videoLd) }} />}
    </>
  );
}
