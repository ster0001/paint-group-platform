import ReviewsSlider from "../_components/ReviewsSlider";
import Link from "next/link";
import VideoEmbed from "../_components/VideoEmbed";
import { getGoogleReviews, trimReview } from "@/lib/marketing/googleReviews";
import { showcaseJobById } from "@/lib/showcase/queries";
import { parseVideoUrl } from "@/lib/marketing/video";
import { melbourneDay, videoObjectLd, videoUploadDateFor } from "@/lib/marketing/videoLd";
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

export default async function Reviews({ featuredVideoJobId = null, featuredVideo = null, audience = "home", copy, poweredBy = null }: {
  featuredVideoJobId?: string | null; featuredVideo?: WebsiteContent["featuredVideo"] | null;
  audience?: Audience; copy?: { h2: string; fallbackH2: string; lead?: string };
  /** Paint Home brief §2: the reviews are Paint Group's; the one-line credit under the cards is the honesty mechanism. */
  poweredBy?: string | null;
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
  // Search Console (28 Oct 2026): uploadDate is required — the day the link was added (written by the
  // Settings save; an older row reads as today until it is saved again). One builder for every video.
  const directLd = direct && directRef ? videoObjectLd({
    name: direct.caption || "A Paint Group customer",
    description: direct.transcript ? direct.transcript.slice(0, 300) : direct.caption || "A customer talks about their painting job.",
    thumbnailUrl: [direct.posterPath ? showcaseMediaUrl(direct.posterPath) : directRef.thumbnailUrl],
    embedUrl: directRef.embedUrl,
    contentUrl: directRef.watchUrl,
    transcript: direct.transcript || null,
    uploadDate: direct.addedOn ?? melbourneDay(),
  }) : null;
  const videoRef = video ? parseVideoUrl(video.video_url!) : null;
  const videoLd = video && videoRef ? videoObjectLd({
    name: video.video_caption || `${video.title} in ${video.suburb}`,
    description: video.review_quote || video.summary || video.scope_line || `${video.title} in ${video.suburb}`,
    thumbnailUrl: [video.video_poster_path ? showcaseMediaUrl(video.video_poster_path) : videoRef.thumbnailUrl],
    embedUrl: videoRef.embedUrl,
    contentUrl: videoRef.watchUrl,
    transcript: video.video_transcript || null,
    uploadDate: videoUploadDateFor(video),
  }) : null;
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
            {copy?.lead && <p className="lead" style={{ marginTop: 14 }}>{copy.lead}</p>}
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
            {videoLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(videoLd) }} />}
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
        {poweredBy && <p className="powered" data-testid="reviews-powered-by">Powered by {poweredBy} · reviews on Google</p>}
      </div>
    </section>
  );
}
