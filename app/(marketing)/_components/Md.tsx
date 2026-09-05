import { parseMd } from "@/lib/marketing/md";

/** Renders the site's tiny markdown (session 8 §3): paragraphs, breaks, bold, links. `inline` keeps one paragraph's runs without <p>. */
export default function Md({ src, inline = false }: { src: string; inline?: boolean }) {
  const blocks = parseMd(src);
  const runs = (line: ReturnType<typeof parseMd>[number][number]) => line.map((r, i) =>
    r.t === "b" ? <strong key={i}>{r.v}</strong>
    : r.t === "a" ? <a key={i} href={r.href} target={r.href.startsWith("http") ? "_blank" : undefined} rel={r.href.startsWith("http") ? "noopener noreferrer" : undefined}>{r.v}</a>
    : <span key={i}>{r.v}</span>);
  if (inline) {
    return <>{blocks.flatMap((p, pi) => p.map((line, li) => <span key={`${pi}-${li}`}>{(pi > 0 || li > 0) && <br />}{runs(line)}</span>))}</>;
  }
  return <>{blocks.map((p, pi) => <p key={pi}>{p.map((line, li) => <span key={li}>{li > 0 && <br />}{runs(line)}</span>)}</p>)}</>;
}
