"use client";

import Image from "next/image";
import { useState } from "react";
import { parseVideoUrl } from "@/lib/marketing/video";
import { showcaseMediaUrl } from "@/lib/showcase/format";

/**
 * A testimonial / progress video (Tom, 5 Sep): a poster with a play button;
 * the YouTube (privacy-enhanced) or Vimeo (dnt) player is created only when
 * the visitor presses play — no autoplay, no third-party iframe on load.
 * The transcript sits under it in a disclosure: accessibility, and text
 * search engines can read.
 */
export default function VideoEmbed({ url, caption, posterPath, transcript, testId = "video" }: {
  url: string; caption?: string | null; posterPath?: string | null; transcript?: string | null; testId?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const ref = parseVideoUrl(url);
  if (!ref) return null;
  const poster = posterPath ? showcaseMediaUrl(posterPath) : ref.thumbnailUrl;
  return (
    <figure className="video" data-testid={testId} data-provider={ref.provider}>
      <div className="video-frame">
        {playing ? (
          <iframe
            src={ref.embedUrl} title={caption ?? "Video"} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin" data-testid={`${testId}-player`}
          />
        ) : (
          <button type="button" className="video-play" onClick={() => setPlaying(true)} aria-label={`Play video${caption ? `: ${caption}` : ""}`} data-testid={`${testId}-play`}>
            {poster && (
              // eslint-disable-next-line @next/next/no-img-element
              posterPath ? <Image src={poster} alt="" fill sizes="(min-width: 960px) 640px, 100vw" style={{ objectFit: "cover" }} /> : <img src={poster} alt="" loading="lazy" />
            )}
            <span className="video-btn" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 26 26"><path d="M8 5v16l13-8z" fill="currentColor" /></svg></span>
          </button>
        )}
      </div>
      {caption && <figcaption className="video-cap">{caption} · <a href={ref.watchUrl} target="_blank" rel="noopener noreferrer">watch on {ref.provider === "youtube" ? "YouTube" : "Vimeo"}</a></figcaption>}
      {transcript && (
        <details className="video-transcript" data-testid={`${testId}-transcript`}>
          <summary>Read the transcript</summary>
          <p>{transcript}</p>
        </details>
      )}
    </figure>
  );
}
