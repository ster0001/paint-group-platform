import ReviewsSlider from "../_components/ReviewsSlider";
import Link from "next/link";
import VideoEmbed from "../_components/VideoEmbed";
import { getGoogleReviews, trimReview } from "@/lib/marketing/googleReviews";
import { showcaseJobById } from "@/lib/showcase/queries";
import { parseVideoUrl } from "@/lib/marketing/video";
import { showcaseMediaUrl } from "@/lib/showcase/format";
import type { WebsiteContent } from "@/lib/marketing/siteContent";
import type { Audience } from "@/lib/marketing/audience";
import { pickReviews } from "@/lib/marketing/reviewTags";
import { getReviewTags } from "@/lib/marketing/siteCopy";
import { syncReviewTags } from "@/lib/marketing/reviewTagsServer";

/**
 * §4.11 — LIVE from the Google listing "Paint Group" (Tom, 5 Sep: the
 * listing with the 93 reviews), on a slider, with the rating, the total
 * count and a link to all of them on Google. Google's API hands back at
 * most five reviews per listing; the link is how a visitor sees the rest.
 * If Google can't be reached the placeholders show instead.
 */
const PLACEHOLDERS = [
  "[Real review: one that mentions the price being what was quoted]",
  "[Real review: one that mentions the photo updates or the painter by name]",
  "[Real review: one that mentions the finish or the prep]",
];

export default async function Reviews({ featuredVideoJobId = null, featuredVideo = null, audience = "home", copy }: {
  featuredVideoJobId?: string | null; featuredVideo?: WebsiteContent["featuredVideo"] | null;
  audience?: Audience; copy?: { h2: string; fallbackH2: string };
}) {
  const h2 = copy?.h2 ?? "What people say once the tape comes off.";
  // Tom, 6 Sep: a testimonial video pasted in Settings → Website wins; a
  // showcase job's video is the fallback.
  const direct = featuredVideo?.url ? featuredVideo : null;
  const [fetched, videoJob, tags] = await Promise.all([getGoogleReviews(), !direct && featuredVideoJobId ? showcaseJobById(featuredVideoJobId) : Promise.resolve(null), getReviewTags()]);
  // Session 8 §5: the import notes its guess per review (Tom confirms in
  // Settings); only confirmed tags filter. Business with fewer than three
  // tagged shows the best untagged under a wider heading.
  if (fetched) await syncReviewTags(fetched.reviews);
  const picked = fetched ? pickReviews(fetched.reviews, tags, audience) : null;
  const live = fetched && picked ? { ...fetched, reviews: picked.reviews } : null;
  const heading = picked?.fallback && copy?.fallbackH2 ? copy.fallbackH2 : h2;
  const video = videoJob?.video_url ? videoJob : null;
  const directRef = direct ? parseVideoUrl(direct.url) : null;
  const directLd = direct && directRef ? {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: direct.caption || "A Paint Group customer",
    description: direct.transcript ? direct.transcript.slice(0, 300) : direct.caption || "A customer talks about their painting job.",
    thumbnailUrl: [direct.posterPath ? showcaseMediaUrl(direct.posterPath) : directRef.thumbnailUrl].filter(Boolean),
    embedUrl: directRef.embedUrl,
    contentUrl: directRef.watchUrl,
    transcript: direct.transcript || undefined,
  } : null;
  const cards = live && live.reviews.length > 0
    ? live.reviews.map((r) => { const t = trimReview(r.text); return { ...r, shown: t.text, trimmed: t.trimmed }; })
    : null;
  return (
    <section className="sec light" id="reviews">
      <div className="wrap">
        <div className="head">
          <div>
            <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }} data-testid="reviews-line">
              {live ? `${live.rating.toFixed(1)} from ${live.count} Google review${live.count === 1 ? "" : "s"}` : "Google reviews"}
            </div>
            <h2>{heading}</h2>
          </div>
          {live?.url && <a href={live.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500 }} data-testid="reviews-all">All {live.count} reviews on Google →</a>}
        </div>
        {direct && directRef && (
          <div className="rev-video" data-testid="featured-video">
            <VideoEmbed url={direct.url} caption={direct.caption || "A customer talks about their job"} posterPath={direct.posterPath} transcript={direct.transcript} testId="featured-video" />
            {directLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(directLd) }} />}
          </div>
        )}
        {!direct && video && (
          <div className="rev-video" data-testid="featured-video">
            <VideoEmbed url={video.video_url!} caption={video.video_caption || `${video.review_name ? video.review_name.split("·")[0].trim() : "A customer"}, ${video.suburb} — ${video.title.toLowerCase()}`} posterPath={video.video_poster_path} transcript={video.video_transcript} testId="featured-video" />
            <p className="rev-video-link"><Link href={`/work/${video.slug}`}>See this job →</Link></p>
          </div>
        )}
        <div data-testid="reviews" data-source={cards ? "google" : "placeholder"}>
          {cards
            ? <ReviewsSlider reviews={cards} />
            : (
              <div className="revs">
                {PLACEHOLDERS.map((p) => (
                  <div className="rev" key={p} data-todo="9.6">
                    <span className="stars" aria-label="Five stars">★★★★★</span><p>{p}</p><small>Name · suburb · job type</small>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </section>
  );
}
