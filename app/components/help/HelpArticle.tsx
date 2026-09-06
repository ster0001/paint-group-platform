import Link from "next/link";
import type { HelpBlock } from "@/lib/help/markdown";
import type { Inline } from "@/lib/marketing/md";
import "./help.css";

/**
 * Renders a parsed help file. Shared by the contractor portal and the staff
 * app (one component, a `mode` prop — CLAUDE.md), so the same markdown reads
 * the same in both. Media paths and Related links arrive already resolved by
 * lib/help/content.ts; this component never builds a URL.
 */
export default function HelpArticle({ blocks, mode }: { blocks: HelpBlock[]; mode: "portal" | "app" }) {
  return (
    <div className={`help-article ${mode}`}>
      {blocks.map((b, i) => {
        if (b.t === "h") return b.level === 2 ? <h2 key={i}>{b.text}</h2> : <h3 key={i}>{b.text}</h3>;
        if (b.t === "p") return <p key={i}>{lines(b.lines)}</p>;
        if (b.t === "img") return <Figure key={i} src={b.src} alt={b.alt} />;
        const items = b.items.map((it, j) => (
          <li key={j}>
            {lines(it.lines)}
            {it.images.map((im, k) => <Figure key={k} src={im.src} alt={im.alt} />)}
          </li>
        ));
        return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
      })}
    </div>
  );
}

function lines(ls: Inline[][]) {
  return ls.map((line, i) => (
    <span key={i}>
      {i > 0 ? <br /> : null}
      {line.map((inl, j) => {
        if (inl.t === "b") return <b key={j}>{inl.v}</b>;
        if (inl.t === "a") return <Link key={j} href={inl.href}>{inl.v}</Link>;
        return <span key={j}>{inl.v}</span>;
      })}
    </span>
  ));
}

function Figure({ src, alt }: { src: string; alt: string }) {
  const film = src.endsWith(".gif");
  return (
    <figure className={film ? "film" : "shot"}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served by our own
          role-gated route from docs/help, not a remote host; next/image would
          have nothing to optimise and cannot animate a GIF */}
      <img src={src} alt={alt || (film ? "Walkthrough" : "Screenshot")} loading="lazy" />
    </figure>
  );
}
