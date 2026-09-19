/**
 * `buildProgressPreview` — the pure function behind the live-progress phone
 * on the customer estimate (brief §5). Reads ONLY the customer payload it is
 * handed (fields already in the sent snapshot, plus the account name and the
 * property references the server already shows on the document) and returns
 * plain-text content for the phone. No database, no clock, no randomness, no
 * AI, no prices, no HTML.
 *
 * Every string in the result is placed by the renderer as a text node, so
 * customer-supplied text (names, addresses, area titles) is carried verbatim
 * and never interpreted as markup.
 */
import { suburbOnly } from "@/lib/scheduling/offers";
import {
  COMMERCIAL_DOC_CHIPS, COMMERCIAL_STAGE_RAIL, EXAMPLE_LABEL, ILLUSTRATION_LINE, LEAD_ROLE, LOCK_SCREEN,
  PHOTO_TAG, STATUS_PILL, TEMPLATES, type MessagingSet, type TextTemplate, type UpdateTemplate,
} from "./templates";

export type { MessagingSet } from "./templates";

/** The subset of the customer snapshot (+ two server-known extras) the builder reads. */
export type ProgressPreviewInput = {
  /** snapshot.contactName — the customer's full name as typed by staff. */
  contactName: string;
  /** accounts.name for a trade account; the org shows on the commercial header. */
  organisationName?: string | null;
  /** snapshot.jobAddress — "43 Keith Street, Alphington VIC 3078" (Places), or free text. */
  jobAddress: string;
  /** snapshot.areas in estimate order: title + the customer's own before photos (public URLs). */
  areas: ReadonlyArray<{ title: string; photos: ReadonlyArray<string> }>;
  /** snapshot.paints — the products on the job. */
  paints: ReadonlyArray<{ name: string; brand: string; category: string; role: string; isPrep: boolean }>;
  /** Property references already printed on the document (trade): PO, Owner … */
  references?: ReadonlyArray<{ label: string; value: string }> | null;
};

/** F1: the Settings "Demo painter", only when they have a photo. */
export type DemoPainter = { name: string; photoUrl: string } | null;

export type PreviewPhoto = { url: string; tag: string };
export type PreviewUpdate = {
  day: string;
  time: string;
  title: string;
  body: string;
  photos: PreviewPhoto[];
  chips: string[];
  pct: number;
  /** Index into `header.rail` (commercial), null for residential. */
  stage: number | null;
  milestone: boolean;
};

export type ProgressPreview = {
  set: MessagingSet;
  label: string;
  line: string;
  lock: { time: string; date: string };
  lead: { name: string | null; role: string; initial: string; photoUrl: string | null };
  header: {
    /** Street line; ellipsised by the renderer. Never empty — the section is not rendered without one. */
    address: string;
    /** Suburb · for Ben Guptill (residential) / suburb · PO · Owner ref (commercial). */
    sub: string;
    brandRight: string;
    rail: string[] | null;
    docs: string[] | null;
    pill: { inProgress: string; done: string };
  };
  texts: { first: string; last: string };
  /** The link shown in the texts (display only, not navigable in the demo). */
  link: string;
  updates: PreviewUpdate[];
  /** Visually hidden narration of the same story for screen readers. */
  summary: string;
  /** How many of the customer's own photos were placed. */
  photosUsed: number;
};

/** brief §4 — the messaging set from the linked account (trade → commercial, else residential). */
export function messagingSetFor(accountType: string | null | undefined): MessagingSet {
  return accountType === "trade" ? "commercial" : "residential";
}

const MAX_PHOTOS_PER_UPDATE = 2;
const FIRST_NAME_MAX = 30;

/** "43 Keith Street, Alphington VIC 3078" → { street: "43 Keith Street", suburb: "Alphington" }. */
export function splitAddress(jobAddress: string): { street: string; suburb: string } {
  const raw = (jobAddress ?? "").trim();
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const first = parts[0] ?? "";
  // A street line carries a number. A bare suburb (no digits) is not a street.
  const street = /\d/.test(first) ? first.replace(/\b(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b\s*\d{4}\s*$/i, "").trim() : "";
  const s = suburbOnly(raw);
  const suburb = s === "Location on acceptance" ? "" : s;
  return { street, suburb };
}

/** The first whitespace-separated token of the contact name, or "". */
export function firstNameOf(contactName: string): string {
  const t = (contactName ?? "").trim().split(/\s+/)[0] ?? "";
  return t.length > FIRST_NAME_MAX ? t.slice(0, FIRST_NAME_MAX - 1) + "…" : t;
}

function isExteriorTitle(title: string): boolean {
  return /^\s*exterior\b/i.test(title) || /\b(elevation|fa[cç]ade)\b/i.test(title);
}

/** "Exterior - Front" → "Front"; anything else unchanged. */
function displayArea(title: string): string {
  return title.replace(/^\s*exterior\s*[-–:]\s*/i, "").trim() || title.trim();
}

function joinNames(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Area groups for {areas_a} {areas_b} {areas_c}: consecutive slices of the
 * estimate's areas in order (2, 3, 3). When the estimate runs out, a group
 * wraps to the start — an area may appear in two DIFFERENT updates, never
 * twice within one (brief §5 "fewer than 3 areas").
 */
export function areaGroups(titles: readonly string[]): { a: string[]; b: string[]; c: string[]; single: string } {
  const t = titles.map(displayArea).filter(Boolean);
  const take = (from: number, n: number): string[] => {
    if (t.length === 0) return [];
    const out: string[] = [];
    for (let i = 0; i < Math.min(n, t.length); i++) {
      const v = t[(from + i) % t.length];
      if (!out.includes(v)) out.push(v);
    }
    return out;
  };
  const a = take(0, 2);
  const b = take(Math.min(2, t.length), 3);
  const c = take(Math.min(5, t.length), 3);
  return { a, b, c, single: t[0] ?? "" };
}

function productFor(paints: ProgressPreviewInput["paints"], kind: "ceiling" | "wall", exterior: boolean): string {
  const test = (p: ProgressPreviewInput["paints"][number]) => {
    const hay = `${p.category} ${p.role}`.toLowerCase();
    if (p.isPrep) return false;
    if (kind === "ceiling") return hay.includes("ceiling");
    if (exterior) return hay.includes("exterior") || hay.includes("weatherboard") || hay.includes("render") || hay.includes("wall");
    return hay.includes("wall") && !hay.includes("exterior");
  };
  const p = paints.find(test);
  if (!p) return kind === "ceiling" ? "ceiling paint" : (exterior ? "exterior top coat" : "wall paint");
  const name = p.name.trim();
  const brand = p.brand.trim();
  return brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
}

function referenceValue(refs: ProgressPreviewInput["references"], re: RegExp): string {
  for (const r of refs ?? []) if (re.test(r.label) && r.value.trim()) return r.value.trim();
  return "";
}

/** Fill placeholders; unknown placeholders are left as-is (a unit test catches that). */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** Tidy a sentence whose {areas_x} came out empty: "under way in the ." → "under way." */
function tidy(s: string): string {
  return s
    .replace(/\s+(in|on|to|of)\s+the\s+([.,])/g, "$2")
    .replace(/\s+(in|on|to|of)\s+([.,])/g, "$2")
    .replace(/^\s*,\s*/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .trim();
}

function pick(t: TextTemplate, lead: DemoPainter): string {
  return lead ? t.withLead : t.noLead;
}

export function buildProgressPreview(input: ProgressPreviewInput, set: MessagingSet, demoPainter: DemoPainter = null): ProgressPreview | null {
  const T = TEMPLATES[set];
  const { street, suburb } = splitAddress(input.jobAddress);
  // brief §5: no street AND no suburb → the section does not render.
  if (!street && !suburb) return null;

  const streetAddress = street || "your property";
  const headerAddress = street || suburb;
  const firstName = firstNameOf(input.contactName);
  const fullName = (input.contactName ?? "").trim();
  const org = (input.organisationName ?? "").trim();
  const lead = demoPainter && demoPainter.name.trim() && demoPainter.photoUrl ? { name: demoPainter.name.trim(), photoUrl: demoPainter.photoUrl } : null;

  const titles = input.areas.map((a) => a.title);
  const exteriorTitles = titles.filter(isExteriorTitle);
  const allExterior = titles.length > 0 && exteriorTitles.length === titles.length;
  const mixed = exteriorTitles.length > 0 && !allExterior;
  const groups = areaGroups(allExterior ? titles : titles.filter((t) => !isExteriorTitle(t)));

  const po = referenceValue(input.references, /\b(po|purchase order)\b/i);
  const ownerRef = referenceValue(input.references, /owner/i);
  const slug = streetAddress.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 18) || "your-job";
  const link = `paintgroup.com.au/j/${slug}`;

  const vars: Record<string, string> = {
    first_name: firstName,
    street_address: streetAddress,
    lead: lead?.name ?? "",
    areas_a: joinNames(groups.a),
    areas_b: joinNames(groups.b),
    areas_c: joinNames(groups.c),
    area: groups.single,
    exterior_areas: joinNames(exteriorTitles.map(displayArea)),
    ceiling_product: productFor(input.paints, "ceiling", allExterior),
    wall_product: productFor(input.paints, "wall", allExterior),
    po: po ? ` (PO ${po.replace(/^po\s*/i, "")})` : "",
    link,
  };

  const textOf = (t: typeof T.firstText): string => {
    const tpl = firstName ? (lead ? t.withLead : t.noLead) : (lead ? t.noName : t.noNameNoLead);
    return tidy(fill(tpl, vars));
  };

  // Photos: the estimate's own, in snapshot order, ≤2 per update, never twice.
  const pool = input.areas.flatMap((a) => a.photos).filter((u, i, arr) => !!u && arr.indexOf(u) === i);
  let cursor = 0;
  const tag = PHOTO_TAG[set];

  const updates: PreviewUpdate[] = T.updates.map((u: UpdateTemplate, i) => {
    const variant = allExterior && u.exterior ? u.exterior : u;
    let body = tidy(fill(pick(variant.body, lead), vars));
    if (mixed && i === 1) body = `${body} ${tidy(fill(T.exteriorMention, vars))}`.trim();
    const photos: PreviewPhoto[] = [];
    if (u.photos) {
      for (let n = 0; n < MAX_PHOTOS_PER_UPDATE && cursor < pool.length; n++) photos.push({ url: pool[cursor++], tag });
    }
    return {
      day: u.day,
      time: u.time,
      title: tidy(fill(variant.title, vars)) || u.day,
      body,
      photos,
      chips: [...(u.chips ?? [])],
      pct: u.pct,
      stage: set === "commercial" ? (u.stage ?? 0) : null,
      milestone: !!u.milestone,
    };
  });

  const texts = { first: textOf(T.firstText), last: textOf(T.lastText) };
  const role = LEAD_ROLE[set];
  const leadOut = { name: lead?.name ?? null, role, initial: (lead?.name ?? role).trim().charAt(0).toUpperCase(), photoUrl: lead?.photoUrl ?? null };

  const header: ProgressPreview["header"] = set === "commercial"
    ? {
        address: headerAddress,
        sub: [suburb, po ? `PO ${po.replace(/^po\s*/i, "")}` : "", ownerRef ? `Owner ref ${ownerRef}` : ""].filter(Boolean).join(" · "),
        brandRight: org || "Your job",
        rail: [...COMMERCIAL_STAGE_RAIL],
        docs: [...COMMERCIAL_DOC_CHIPS],
        pill: { ...STATUS_PILL },
      }
    : {
        address: headerAddress,
        sub: [suburb, fullName ? `for ${fullName}` : ""].filter(Boolean).join(" · "),
        brandRight: "Your job",
        rail: null,
        docs: null,
        pill: { ...STATUS_PILL },
      };

  const summary = [
    EXAMPLE_LABEL + ".",
    `Text message: ${texts.first}`,
    `${headerAddress}${header.sub ? `, ${header.sub}` : ""}. ${leadOut.name ? `${leadOut.name}, ${role}.` : `${role}.`}`,
    ...updates.map((u) => `${u.day}, ${u.time}: ${u.title}. ${u.body}${u.photos.length ? ` ${u.photos.length} photo${u.photos.length > 1 ? "s" : ""}.` : ""}`),
    `Text message: ${texts.last}`,
    ILLUSTRATION_LINE[set],
  ].join(" ");

  return {
    set,
    label: EXAMPLE_LABEL,
    line: ILLUSTRATION_LINE[set],
    lock: { ...LOCK_SCREEN },
    lead: leadOut,
    header,
    texts,
    link,
    updates,
    summary,
    photosUsed: cursor,
  };
}
