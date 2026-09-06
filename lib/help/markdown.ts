import { inlines, type Inline } from "@/lib/marketing/md";

/**
 * The help files' markdown (docs/help/_template.md): `##`/`###` headings,
 * paragraphs, numbered steps and bullet lists (with a screenshot indented under
 * a step), standalone images, and the inline grammar the marketing copy already
 * has (**bold**, [links]). Nothing else is markdown; anything else is text.
 *
 * Pure and unit-tested. The block parser is here; the inline grammar is
 * `lib/marketing/md.ts` — one grammar, extended, not a second one.
 */

export type HelpBlock =
  | { t: "h"; level: 2 | 3; text: string }
  | { t: "p"; lines: Inline[][] }
  | { t: "img"; src: string; alt: string }
  | { t: "list"; ordered: boolean; items: HelpListItem[] };

export type HelpListItem = { lines: Inline[][]; images: { src: string; alt: string }[] };

const IMG = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const H = /^(#{2,3})\s+(.*)$/;
const OL = /^(\d+)\.\s+(.*)$/;
const UL = /^[-*]\s+(.*)$/;

/** Split the front-matter off; returns the body only. */
export function stripFrontMatter(src: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(src);
  return m ? src.slice(m[0].length) : src;
}

export function parseHelp(src: string): HelpBlock[] {
  const lines = stripFrontMatter(src).replace(/\r\n/g, "\n").split("\n");
  const blocks: HelpBlock[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: HelpListItem[] } | null = null;

  const flushPara = () => {
    if (para.length) { blocks.push({ t: "p", lines: para.map((l) => inlines(l)) }); para = []; }
  };
  const flushList = () => {
    if (list) { blocks.push({ t: "list", ordered: list.ordered, items: list.items }); list = null; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flushPara(); flushList(); continue; }

    const h = H.exec(line);
    if (h) { flushPara(); flushList(); blocks.push({ t: "h", level: h[1].length === 2 ? 2 : 3, text: h[2].trim() }); continue; }

    const indented = /^\s{2,}/.test(raw);
    const img = IMG.exec(line.trim());

    if (indented && list) {
      // A continuation of the current item: its screenshot, or more of its text.
      const item = list.items[list.items.length - 1];
      if (img) item.images.push({ src: img[2], alt: img[1] });
      else item.lines.push(inlines(line.trim()));
      continue;
    }

    const ol = OL.exec(line);
    const ul = UL.exec(line);
    if (ol || ul) {
      flushPara();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push({ lines: [inlines((ol ? ol[2] : ul![1]).trim())], images: [] });
      continue;
    }

    if (img) { flushPara(); flushList(); blocks.push({ t: "img", src: img[2], alt: img[1] }); continue; }

    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain text of a parsed file — for search and summaries. */
export function helpToText(blocks: HelpBlock[]): string {
  const line = (l: Inline[]) => l.map((i) => i.v).join("");
  return blocks.map((b) => {
    if (b.t === "h") return b.text;
    if (b.t === "p") return b.lines.map(line).join(" ");
    if (b.t === "list") return b.items.map((it) => it.lines.map(line).join(" ")).join(" ");
    return b.alt;
  }).join("\n");
}
