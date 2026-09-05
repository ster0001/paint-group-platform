/**
 * Testimonial / progress videos (Tom, 5 Sep 2026): YouTube (unlisted is
 * fine) or Vimeo, embedded with the privacy-enhanced players and never
 * loaded until the visitor presses play. One place understands the URLs.
 */
export type VideoRef = { provider: "youtube" | "vimeo"; id: string; embedUrl: string; watchUrl: string; thumbnailUrl: string | null };

export function parseVideoUrl(raw: string | null | undefined): VideoRef | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") return yt(u.pathname.slice(1).split("/")[0]);
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") return yt(u.searchParams.get("v") ?? "");
    const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{6,})/);
    if (m) return yt(m[1]);
    return null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/(\d{6,})/);
    if (!m) return null;
    const id = m[1];
    return { provider: "vimeo", id, embedUrl: `https://player.vimeo.com/video/${id}?dnt=1&autoplay=1`, watchUrl: `https://vimeo.com/${id}`, thumbnailUrl: null };
  }
  return null;
}

function yt(id: string): VideoRef | null {
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
  return {
    provider: "youtube", id,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`,
    watchUrl: `https://www.youtube.com/watch?v=${id}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}
