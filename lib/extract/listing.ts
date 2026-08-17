/**
 * Real-estate listing links.
 *
 * A listing page carries things a floorplan does not: the bed/bath/car counts,
 * the property type, and often a description that mentions the very things we
 * otherwise have to ask about ("high ceilings", "ornate cornices", "square-set").
 *
 * TWO CONSTRAINTS SHAPE THIS FILE.
 *
 * 1. Fetching a URL supplied by a user, from our own server, is a request
 *    forgery risk: "http://localhost", "http://169.254.169.254" and friends
 *    would be fetched with our network position, not the user's. So this is an
 *    ALLOW-LIST of real-estate domains, https only, with no redirects followed
 *    to anywhere off the list.
 *
 * 2. Anything read off a listing is MARKETING COPY, not a measurement. It is
 *    used to cross-check the room count and to raise questions ("the listing
 *    says high ceilings — confirm the height"), never to set a number. The
 *    plan and the photos remain the only sources of geometry.
 */

const ALLOWED_HOSTS = [
  "realestate.com.au",
  "domain.com.au",
  "allhomes.com.au",
  "onthehouse.com.au",
  "realestateview.com.au",
  "homely.com.au",
  "raywhite.com",
  "jellis.com.au",
  "kayburton.com.au",
  "garypeer.com.au",
  "belleproperty.com",
  "mcgrath.com.au",
  "barryplant.com.au",
  "hockingstuart.com.au",
  "buxton.com.au",
  "woodards.com.au",
  "nelsonalexander.com.au",
];

export type ListingCheck =
  | { ok: true; url: URL }
  | { ok: false; message: string };

/** Is this a listing URL we are willing to fetch from our own server? */
export function checkListingUrl(raw: string): ListingCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: "That doesn't look like a web address." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, message: "Listing links must start with https://." };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const allowed = ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!allowed) {
    return {
      ok: false,
      message: `${host} isn't a listing site we read. Supported: realestate.com.au, domain.com.au and the major Melbourne agencies. Anything else, save the photos and upload them instead.`,
    };
  }

  return { ok: true, url };
}

export type ListingFacts = {
  title: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carSpaces: number | null;
  /** Phrases worth asking about, quoted from the page. Never used as numbers. */
  mentions: Array<{ topic: "ceiling_height" | "cornices" | "condition" | "renovation"; quote: string }>;
};

const MENTION_PATTERNS: Array<{ topic: ListingFacts["mentions"][number]["topic"]; re: RegExp }> = [
  { topic: "ceiling_height", re: /\b(high|soaring|lofty|raked|cathedral|\d(?:\.\d)?\s*metre)\s+ceilings?\b/gi },
  { topic: "cornices", re: /\b(ornate|decorative|period|square[- ]set|deep)\s+cornices?\b/gi },
  { topic: "condition", re: /\b(original condition|needs work|renovator|as new|freshly painted)\b/gi },
  { topic: "renovation", re: /\b(renovated|restored|extended|rebuilt)\b/gi },
];

/** Pull the few facts we trust out of a listing page's HTML. */
export function parseListing(html: string): ListingFacts {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

  const num = (re: RegExp): number | null => {
    const m = text.match(re);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n >= 0 && n < 30 ? n : null;
  };

  const mentions: ListingFacts["mentions"] = [];
  for (const { topic, re } of MENTION_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      mentions.push({ topic, quote: text.slice(Math.max(0, at - 40), at + 80).trim() });
      if (mentions.length >= 12) break;
    }
  }

  const titleMatch = html.match(/<title[^>]*>([^<]{3,160})<\/title>/i);

  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    bedrooms: num(/(\d+)\s*(?:bed(?:room)?s?\b)/i),
    bathrooms: num(/(\d+)\s*(?:bath(?:room)?s?\b)/i),
    carSpaces: num(/(\d+)\s*(?:car\s*(?:space|park|s)?\b|garage)/i),
    mentions,
  };
}

/**
 * Cross-check a listing against what the plan produced. Returns questions, not
 * corrections — the listing is copy written to sell a house.
 */
export function crossCheck(facts: ListingFacts, counts: { bedrooms: number; bathrooms: number }) {
  const notes: string[] = [];
  if (facts.bedrooms != null && facts.bedrooms !== counts.bedrooms) {
    notes.push(`The listing says ${facts.bedrooms} bedrooms; the plan gave ${counts.bedrooms}. Check nothing was missed.`);
  }
  if (facts.bathrooms != null && facts.bathrooms !== counts.bathrooms) {
    notes.push(`The listing says ${facts.bathrooms} bathrooms; the plan gave ${counts.bathrooms}.`);
  }
  for (const m of facts.mentions) {
    if (m.topic === "ceiling_height") notes.push(`The listing mentions ceilings: "${m.quote}". Confirm the height before pricing.`);
    if (m.topic === "cornices") notes.push(`The listing mentions cornices: "${m.quote}". A photo would settle it.`);
  }
  return notes;
}
