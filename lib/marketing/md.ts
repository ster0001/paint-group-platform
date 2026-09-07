/**
 * The only markdown the site allows (session 8 §3): paragraphs (blank line),
 * line breaks, **bold** and [links](https://…). Everything else is text.
 * Pure, so it is unit-tested; the renderer in the sections maps the blocks.
 */
export type Inline = { t: "text"; v: string } | { t: "b"; v: string } | { t: "a"; v: string; href: string };
export type Block = Inline[][]; // paragraph → lines → inlines

// Absolute, site-relative, in-page — and, for the help files, a relative path
// to another help file (`../self-invoicing/contractor.md`); lib/help/content.ts
// resolves those to routes and drops the ones a reader may not follow.
const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*|#[^\s)]*|(?:\.\.\/)+[A-Za-z0-9._\/-]+|[A-Za-z0-9_-]+\.md)\)/;
const BOLD = /\*\*([^*]+)\*\*/;

/** Exported for the help renderer (lib/help/markdown.ts), which reuses the inline grammar. */
export function inlines(line: string): Inline[] {
  const out: Inline[] = [];
  let rest = line;
  while (rest.length) {
    const l = LINK.exec(rest); const b = BOLD.exec(rest);
    const first = [l, b].filter((m): m is RegExpExecArray => Boolean(m)).sort((x, y) => x.index - y.index)[0];
    if (!first) { out.push({ t: "text", v: rest }); break; }
    if (first.index > 0) out.push({ t: "text", v: rest.slice(0, first.index) });
    if (first === l) out.push({ t: "a", v: l![1], href: l![2] });
    else out.push({ t: "b", v: b![1] });
    rest = rest.slice(first.index + first[0].length);
  }
  return out;
}

export function parseMd(src: string): Block[] {
  return src.replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => p.split("\n").map((line) => inlines(line)));
}

/** Plain text (for schema.org and meta), markup stripped. */
export function mdToText(src: string): string {
  return parseMd(src).map((p) => p.map((line) => line.map((i) => i.v).join("")).join(" ")).join(" ");
}
