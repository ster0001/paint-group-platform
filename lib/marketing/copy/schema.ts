import type { Audience } from "../audience";

/**
 * Session 8 §3 — every string on the homepage, by section and key. This is
 * the ONE list: the seed migration, the Settings → Website editor and the
 * runtime reader all walk it, so a key cannot exist in one and not the
 * others. `kind` decides the editor control; "markdown" keys render through
 * lib/marketing/md.ts (paragraphs, bold, links — nothing else).
 */
export const SECTIONS = ["nav", "hero", "estimator_examples", "how_it_works", "jobs", "promise", "story", "live", "painters", "trade", "reviews", "faq", "cta", "meta"] as const;
export type Section = (typeof SECTIONS)[number];

export type FieldKind = "text" | "textarea" | "markdown";
export type Field = { section: Section; key: string; label: string; kind: FieldKind };

const f = (section: Section, key: string, label: string, kind: FieldKind = "text"): Field => ({ section, key, label, kind });

export const SECTION_LABEL: Record<Section, string> = {
  nav: "Navigation", hero: "Hero", estimator_examples: "Self-typing estimator", how_it_works: "How it works",
  jobs: "Real jobs, real prices", promise: "Our promise", story: "Progress story", live: "Live strip",
  painters: "Who'll be painting", trade: "Trade lane", reviews: "Reviews", faq: "FAQ", cta: "Closing CTA", meta: "Page title and description",
};

export const CONTENT_FIELDS: readonly Field[] = [
  f("nav", "link_1_label", "Link 1"), f("nav", "link_1_href", "Link 1 goes to"),
  f("nav", "link_2_label", "Link 2"), f("nav", "link_2_href", "Link 2 goes to"),
  f("nav", "link_3_label", "Link 3"), f("nav", "link_3_href", "Link 3 goes to"),
  f("nav", "link_4_label", "Link 4"), f("nav", "link_4_href", "Link 4 goes to"),
  f("nav", "other_audience_label", "Link to the other site"),
  f("nav", "cta", "Nav button"),

  f("hero", "kicker", "Kicker (small line above the heading)"),
  f("hero", "h1", "Heading (one line per row)", "textarea"),
  f("hero", "lead", "Lead paragraph", "markdown"),
  f("hero", "talk_line", "Rather talk to a person line"),
  f("hero", "chip_home", "Chip: home"), f("hero", "chip_business", "Chip: business"),
  f("hero", "chips_label", "Label before the chips"),
  f("hero", "placeholder", "Address field placeholder"), f("hero", "button", "Field button"),

  ...[1, 2, 3].flatMap((n) => [
    f("estimator_examples", `example_${n}_address`, `Example ${n}: address`),
    f("estimator_examples", `example_${n}_price`, `Example ${n}: price range`),
    f("estimator_examples", `example_${n}_time`, `Example ${n}: time line`),
  ]),

  f("how_it_works", "h2", "Heading"),
  ...[1, 2, 3, 4].flatMap((n) => [f("how_it_works", `step_${n}_title`, `Step ${n} title`), f("how_it_works", `step_${n}_body`, `Step ${n} body`, "textarea")]),
  f("how_it_works", "talk_line", "Rather talk to a person line"),

  f("jobs", "kicker", "Kicker"), f("jobs", "h2", "Heading"), f("jobs", "lead", "Lead", "markdown"), f("jobs", "all_link", "All jobs link"),

  f("promise", "kicker", "Kicker"), f("promise", "h2", "Heading"), f("promise", "lead", "Lead"),
  f("promise", "panel_kicker", "Panel kicker"),
  ...[1, 2, 3, 4].flatMap((n) => [
    f("promise", `row_${n}_title`, `Promise ${n}: title`),
    f("promise", `row_${n}_sub`, `Promise ${n}: one line under it`),
    f("promise", `row_${n}_heading`, `Promise ${n}: panel heading`),
    f("promise", `row_${n}_note`, `Promise ${n}: panel note`, "textarea"),
  ]),

  f("story", "kicker", "Kicker"), f("story", "h2", "Heading"), f("story", "lead", "Lead"),
  f("story", "phone_address", "Phone: the job's address"), f("story", "phone_meta", "Phone: the job line under the address"),
  f("story", "signed_line", "Phone: the signed-off line"),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => f("story", `beat_${n}`, `Caption ${n}${n === 9 ? " (business only, 13 s)" : ""}`)),

  f("live", "heading", "Heading"),

  f("painters", "h2", "Heading"), f("painters", "lead", "Intro", "markdown"),
  ...[1, 2, 3, 4].map((n) => f("painters", `rule_${n}`, `Statement ${n}`)),

  f("trade", "kicker", "Kicker"), f("trade", "h2", "Heading"), f("trade", "lead", "Lead", "markdown"),
  f("trade", "cta_1", "Button 1"), f("trade", "cta_2", "Button 2"),

  f("reviews", "h2", "Heading"), f("reviews", "fallback_h2", "Heading when business reviews run short"),

  f("faq", "h2", "Heading"),
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [f("faq", `q_${n}`, `Question ${n}`), f("faq", `a_${n}`, `Answer ${n}`, "markdown")]),

  f("cta", "h2", "Heading"), f("cta", "call_line", "Or call line (after the number)"),

  f("meta", "title_tag", "Title tag"), f("meta", "meta_description", "Meta description", "textarea"), f("meta", "service_type", "Schema serviceType"),
];

/** section → key → value. */
export type SiteCopy = Record<Section, Record<string, string>>;

export const SECTION_FIELDS: Record<Section, Field[]> = SECTIONS.reduce((acc, s) => {
  acc[s] = CONTENT_FIELDS.filter((x) => x.section === s);
  return acc;
}, {} as Record<Section, Field[]>);

export function isSection(v: unknown): v is Section {
  return typeof v === "string" && (SECTIONS as readonly string[]).includes(v);
}

export type CopySet = { audience: Audience; copy: SiteCopy };

/** Every field present, no extras — the unit test holds both sets to it. */
export function missingKeys(copy: SiteCopy): string[] {
  const out: string[] = [];
  for (const fld of CONTENT_FIELDS) if (!(copy[fld.section]?.[fld.key] ?? "").trim() && !(fld.section === "story" && fld.key === "beat_9")) out.push(`${fld.section}.${fld.key}`);
  return out;
}
