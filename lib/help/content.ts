import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseHelp, helpToText, type HelpBlock } from "./markdown";
import { searchIn, type SearchHit } from "./search";
import { parseTour, tourProblems, type TourCard } from "./tour";
import type { Inline } from "@/lib/marketing/md";

// SERVER ONLY — reads docs/help/** with fs. Never import from a Client Component.

/**
 * The help centre's one source: docs/help/_index.json (written by
 * scripts/help-index.ts) and the markdown files it lists. Nothing here is
 * stored anywhere else; a guide that is not in the index does not exist.
 *
 * Role scoping is by construction: every reader takes the roles the session
 * may see and only ever opens files whose front-matter role is one of them.
 */

export type HelpRole = "staff" | "pc" | "contractor" | "customer";

export type HelpEntry = {
  feature: string;
  role: HelpRole;
  title: string;
  summary: string;
  path: string;
  walkthrough: string | null;
  media: string[];
  verified_at_commit: string | null;
  sources: string[];
};

export type HelpGuide = {
  entry: HelpEntry;
  blocks: HelpBlock[];
  text: string;
};

const HELP_ROOT = resolve(process.cwd(), "docs", "help");

/** The roles a session may read. Office staff read staff + pc; a painter reads contractor. */
export function rolesFor(kind: "staff" | "contractor"): HelpRole[] {
  return kind === "staff" ? ["staff", "pc"] : ["contractor"];
}

export function loadHelpIndex(): HelpEntry[] {
  const p = join(HELP_ROOT, "_index.json");
  if (!existsSync(p)) return [];
  const parsed = JSON.parse(readFileSync(p, "utf8")) as { files?: HelpEntry[] };
  return parsed.files ?? [];
}

export function guidesFor(roles: HelpRole[]): HelpEntry[] {
  return loadHelpIndex().filter((e) => roles.includes(e.role));
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The route a "Related" link to another help file resolves to, for this reader — or null (rendered as text). */
export function relatedHref(href: string, roles: HelpRole[], base: "portal" | "app"): string | null {
  // ../<feature>/<role>.md or <role>.md (same feature is not used by the template, but tolerate it)
  const m = /^(?:\.\.\/)?([a-z0-9-]+)\/(staff|pc|contractor|customer)\.md$/.exec(href);
  if (!m) return null;
  const [, feature, role] = m;
  if (!roles.includes(role as HelpRole)) return null;
  if (!loadHelpIndex().some((e) => e.feature === feature && e.role === role)) return null;
  return base === "portal" ? `/portal/help/${feature}` : `/help/${feature}/${role}`;
}

/** Rewrite media paths to the media route and Related links to routes; drop links the reader may not follow. */
function rewrite(blocks: HelpBlock[], feature: string, roles: HelpRole[], base: "portal" | "app"): HelpBlock[] {
  const media = (src: string) => (src.startsWith("media/") ? `/api/help/media/${feature}/${src.slice("media/".length)}` : src);
  const inl = (line: Inline[]): Inline[] =>
    line.map((i) => {
      if (i.t !== "a") return i;
      if (/^https?:\/\//.test(i.href)) return i;
      const to = relatedHref(i.href, roles, base);
      return to ? { ...i, href: to } : { t: "text", v: i.v };
    });
  return blocks.map((b) => {
    if (b.t === "img") return { ...b, src: media(b.src) };
    if (b.t === "p") return { ...b, lines: b.lines.map(inl) };
    if (b.t === "list") return { ...b, items: b.items.map((it) => ({ lines: it.lines.map(inl), images: it.images.map((im) => ({ ...im, src: media(im.src) })) })) };
    return b;
  });
}

/** One guide, for a reader who may see `roles`; null when it does not exist for them (404, never 403). */
export function readGuide(feature: string, role: HelpRole, roles: HelpRole[], base: "portal" | "app"): HelpGuide | null {
  if (!SLUG.test(feature) || !roles.includes(role)) return null;
  const entry = loadHelpIndex().find((e) => e.feature === feature && e.role === role);
  if (!entry) return null;
  const file = join(HELP_ROOT, feature, `${role}.md`);
  if (!existsSync(file)) return null;
  const blocks = parseHelp(readFileSync(file, "utf8"));
  return { entry, blocks: rewrite(blocks, feature, roles, base), text: helpToText(blocks) };
}

/** May this reader fetch this media file? Only files the index lists for a guide they can read. */
export function mediaPathFor(feature: string, file: string, roles: HelpRole[]): string | null {
  if (!SLUG.test(feature) || !/^[a-z0-9]+-[a-z0-9-]+\.(png|gif|jpg|jpeg|webp)$/.test(file)) return null;
  const rel = `media/${file}`;
  const listed = loadHelpIndex().some(
    (e) => e.feature === feature && roles.includes(e.role) && (e.media.includes(rel) || e.walkthrough === rel),
  );
  if (!listed) return null;
  const p = join(HELP_ROOT, feature, "media", file);
  return existsSync(p) ? p : null;
}

export const MEDIA_TYPES: Record<string, string> = {
  png: "image/png", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};

export type GuideHit = { entry: HelpEntry; snippet: string };

/**
 * Search the guides this reader may see. Role filtering happens BEFORE any
 * text is read, so a contractor query is ranked against contractor files only
 * — an office sentence can never be a snippet on the portal.
 */
export function searchGuides(q: string, roles: HelpRole[]): GuideHit[] {
  const entries = guidesFor(roles);
  const docs = entries.flatMap((e) => {
    const file = join(HELP_ROOT, e.feature, `${e.role}.md`);
    if (!existsSync(file)) return [];
    return [{ key: `${e.feature}/${e.role}`, title: e.title, summary: e.summary, text: helpToText(parseHelp(readFileSync(file, "utf8"))) }];
  });
  const byKey = new Map(entries.map((e) => [`${e.feature}/${e.role}`, e]));
  return searchIn(q, docs).flatMap((h: SearchHit) => {
    const entry = byKey.get(h.key);
    return entry ? [{ entry, snippet: h.snippet }] : [];
  });
}

/** The guided tour for a role — docs/help/_tours/<role>.md — or no cards when it is missing or malformed. */
export function loadTour(role: HelpRole): TourCard[] {
  const file = join(HELP_ROOT, "_tours", `${role}.md`);
  if (!existsSync(file)) return [];
  const cards = parseTour(readFileSync(file, "utf8"));
  return tourProblems(cards).length ? [] : cards;
}
