"use client";

import { useRef, useState } from "react";
import { safeParse, validReviews, blockHasContent, type BlockKind } from "@/lib/presentations/schema";

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const mediaUrl = (path: string) => (!path ? "" : /^https?:\/\//.test(path) ? path : `${BASE}/storage/v1/object/public/presentation-media/${path}`);
const docUrl = (path: string) => (!path ? "" : /^https?:\/\//.test(path) ? path : `${BASE}/storage/v1/object/public/presentation-docs/${path}`);

// "Painted our ==warehouse exterior== over…" → cyan highlight span.
function highlight(body: string) {
  const parts = body.split(/(==[^=]+==)/g);
  return parts.map((p, i) => (p.startsWith("==") && p.endsWith("==")) ? <mark key={i}>{p.slice(2, -2)}</mark> : <span key={i}>{p}</span>);
}
function youTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : null;
}

export default function PresentationBlocks({ blocks }: { blocks: { kind: string; content: unknown }[] }) {
  const visible = blocks.filter((b) => blockHasContent(b.kind as BlockKind, b.content));
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((b, i) => {
        const kind = b.kind as BlockKind;
        if (kind === "video") return <VideoBlock key={i} c={safeParse(kind, b.content) as never} />;
        if (kind === "before_after_gallery") return <BeforeAfterBlock key={i} c={safeParse(kind, b.content) as never} />;
        if (kind === "review_set") return <ReviewBlock key={i} c={safeParse(kind, b.content) as never} />;
        if (kind === "capability_panel") return <CapabilityBlock key={i} c={safeParse(kind, b.content) as never} />;
        return null;
      })}
    </>
  );
}

function VideoBlock({ c }: { c: { title: string; description: string; videos: { url: string; storage_path: string; poster_path: string; caption_title: string; caption_sub: string; duration_label: string }[] } }) {
  const v = c.videos.find((x) => x.url || x.storage_path || x.poster_path);
  if (!v) return null;
  const [playing, setPlaying] = useState(false);
  const yid = v.url ? youTubeId(v.url) : null;
  const poster = mediaUrl(v.poster_path) || (yid ? `https://img.youtube.com/vi/${yid}/hqdefault.jpg` : "");
  return (
    <section className="pres">
      {c.title && <h2>{c.title}</h2>}
      {c.description && <p className="sub">{c.description}</p>}
      <div className="pvideo">
        {playing ? (
          yid
            ? <iframe className="pvideo-frame" src={`https://www.youtube.com/embed/${yid}?autoplay=1&rel=0`} title={v.caption_title} allow="autoplay; encrypted-media; fullscreen" allowFullScreen />
            // eslint-disable-next-line jsx-a11y/media-has-caption
            : <video className="pvideo-frame" src={mediaUrl(v.storage_path)} controls autoPlay />
        ) : (
          <button className="pvideo-poster" onClick={() => setPlaying(true)} style={poster ? { backgroundImage: `url(${poster})` } : undefined} aria-label="Play video">
            {v.duration_label && <span className="dur">{v.duration_label}</span>}
            <span className="play" />
            {(v.caption_title || v.caption_sub) && (
              <span className="cap"><b>{v.caption_title}</b>{v.caption_sub && <span>{v.caption_sub}</span>}</span>
            )}
          </button>
        )}
      </div>
    </section>
  );
}

function BeforeAfterBlock({ c }: { c: { title: string; description: string; pairs: { before_path: string; after_path: string; info_title: string; info_subtitle: string }[] } }) {
  const pairs = c.pairs.filter((p) => p.before_path && p.after_path);
  if (pairs.length === 0) return null;
  return (
    <section className="pres">
      {c.title && <h2>{c.title}</h2>}
      {c.description && <p className="sub">{c.description}</p>}
      <div className="bagrid">{pairs.map((p, i) => <BAItem key={i} p={p} />)}</div>
    </section>
  );
}
function BAItem({ p }: { p: { before_path: string; after_path: string; info_title: string; info_subtitle: string } }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [x, setX] = useState(55);
  const move = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    setX(Math.max(6, Math.min(94, ((clientX - r.left) / r.width) * 100)));
  };
  const down = (e: React.PointerEvent) => {
    move(e.clientX);
    const mv = (e2: PointerEvent) => move(e2.clientX);
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  return (
    <div className="ba" ref={ref} onPointerDown={down} style={{ ["--x" as string]: `${x}%` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="ba-img before" src={mediaUrl(p.before_path)} alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="ba-img after" src={mediaUrl(p.after_path)} alt="" style={{ clipPath: `inset(0 calc(100% - ${x}%) 0 0)` }} />
      <span className="edge" style={{ left: `${x}%` }} />
      <span className="knob" style={{ left: `${x}%` }}>⇄</span>
      <span className="lab b">BEFORE</span><span className="lab a">AFTER</span>
      {(p.info_title || p.info_subtitle) && <div className="tag"><b>{p.info_title}</b>{p.info_subtitle && <span>{p.info_subtitle}</span>}</div>}
    </div>
  );
}

function ReviewBlock({ c }: { c: { title: string; reviews: { body: string; reviewer_title: string; company_name: string; source: string }[]; footer_line: string } }) {
  const reviews = validReviews(c.reviews);
  if (reviews.length === 0) return null;
  return (
    <section className="pres">
      {c.title && <h2>{c.title}</h2>}
      <div className="revs">
        {reviews.map((r, i) => (
          <div className="rev" key={i}>
            <div className="stars">★★★★★</div>
            <p>&ldquo;{highlight(r.body)}&rdquo;</p>
            <footer>{[r.reviewer_title, r.company_name, r.source].filter(Boolean).join(" · ").toUpperCase()}</footer>
          </div>
        ))}
      </div>
      {c.footer_line && <div className="gbadge">{c.footer_line}</div>}
    </section>
  );
}

function CapabilityBlock({ c }: { c: { title: string; cards: { icon: string; heading: string; body: string; attachment?: { label: string; doc_path: string } }[] } }) {
  const cards = c.cards.filter((x) => x.heading || x.body);
  if (cards.length === 0) return null;
  return (
    <section className="pres">
      {c.title && <h2>{c.title}</h2>}
      <div className="capgrid">
        {cards.map((card, i) => (
          <div className="cap" key={i}>
            <h3>{card.icon && <i>{card.icon}</i>} {card.heading}</h3>
            {card.body && <p>{card.body}</p>}
            {card.attachment?.doc_path && card.attachment.label && (
              <a className="doc" href={docUrl(card.attachment.doc_path)} target="_blank" rel="noreferrer">{card.attachment.label}</a>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
