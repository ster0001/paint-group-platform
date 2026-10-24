import { z } from "zod";
import type { Audience } from "./audience";
import { PAINTHOME_DEFAULT_DOMAIN } from "./audience";
import { HOURS_LINE, PHONE_DISPLAY, PHONE_TEL } from "./site";

/**
 * Paint Home brief §3 — ONE brand record per shopfront, read by the nav,
 * the footer, the metadata, the LocalBusiness schema, the OG image and the
 * favicon. Pure and client-safe: the defaults live here, Settings → Brands
 * (lib/marketing/brandServer.ts) lays the editable face over them. Paint
 * Group's palette is untouched; Paint Home's tokens (§1a) are the CSS block
 * `[data-brand="painthome"]` in app/(marketing)/marketing.css, keyed to
 * `--brand-primary` which this record sets.
 *
 * Audience → brand: `painthome` is Paint Home; `home` and `business` are
 * both Paint Group (one brand, two domains — Session 8).
 */
export type BrandKey = "paintgroup" | "painthome";

export type Brand = {
  key: BrandKey;
  name: string;
  tagline: string;
  /** Hostname, no scheme. */
  domain: string;
  /** The public origin, `https://` + domain. */
  url: string;
  phoneDisplay: string;
  phoneTel: string;
  hoursLine: string;
  /** The footer's legal entity line. */
  legalLine: string;
  /** The small-print credit (reviews, footer; Tom, 25 Oct: not beside the nav logo) — Paint Home only. */
  poweredBy: string | null;
  /** The painter card's line, with `{year}` for the start year (§4: "painting with us since YYYY"). */
  sinceTemplate: string;
  /** The accent colour that drives `--brand-primary` (Settings → Brands: changing it changes `--brand` everywhere). */
  primaryColour: string;
  /** The hex used for the OG image / favicon background. */
  inkColour: string;
  /** schema.org LocalBusiness `@id` — Paint Home's is its own, with `parentOrganization` → Paint Group's (§3). */
  localBusinessId: string;
  parentBusinessId: string | null;
};

export const PAINT_GROUP_BUSINESS_ID = "https://paintgroup.com.au/#business";

const HEX = /^#[0-9a-fA-F]{6}$/;

export const BRAND_DEFAULTS: Record<BrandKey, Brand> = {
  paintgroup: {
    key: "paintgroup",
    name: "Paint Group",
    tagline: "Transforming spaces. Redefining painting.",
    domain: "paintgroup.com.au",
    url: "https://paintgroup.com.au",
    phoneDisplay: PHONE_DISPLAY,
    phoneTel: PHONE_TEL,
    hoursLine: HOURS_LINE,
    legalLine: "",
    poweredBy: null,
    sinceTemplate: "with Paint Group since {year}",
    primaryColour: "#3bd8e9",
    inkColour: "#0a0b0d",
    localBusinessId: PAINT_GROUP_BUSINESS_ID,
    parentBusinessId: null,
  },
  painthome: {
    key: "painthome",
    name: "Paint Home",
    tagline: "Your qualified local painters",
    domain: PAINTHOME_DEFAULT_DOMAIN,
    url: `https://${PAINTHOME_DEFAULT_DOMAIN}`,
    // ⚑ P10: Paint Group's number for launch; the CRM tags the call.
    phoneDisplay: PHONE_DISPLAY,
    phoneTel: PHONE_TEL,
    hoursLine: HOURS_LINE,
    legalLine: "Enlvn Pty Ltd trading as Paint Home",
    poweredBy: "Paint Group",
    sinceTemplate: "painting with us since {year}",
    primaryColour: "#17F9F1",
    inkColour: "#2E3A3D",
    localBusinessId: `https://${PAINTHOME_DEFAULT_DOMAIN}/#business`,
    parentBusinessId: PAINT_GROUP_BUSINESS_ID,
  },
};

export function brandKeyOf(audience: Audience): BrandKey {
  return audience === "painthome" ? "painthome" : "paintgroup";
}

/** `03 8840 9414` → `tel:0388409414`; a number with a country code keeps its `+`. */
export function telHref(display: string): string {
  const digits = display.replace(/[^\d+]/g, "");
  return `tel:${digits.startsWith("+") ? "+" + digits.slice(1).replace(/\+/g, "") : digits}`;
}

/** The editable face of a brand (Settings → Brands). Every field optional; blank = the default. */
export const brandEditableSchema = z.object({
  domain: z.string().trim().toLowerCase().max(120).regex(/^([a-z0-9-]+\.)+[a-z]{2,}$|^$/, "A hostname, like painthome.com.au.").default(""),
  phoneDisplay: z.string().trim().max(24).regex(/^[\d+][\d ]*$|^$/, "Digits and spaces only.").default(""),
  legalLine: z.string().trim().max(160).default(""),
  primaryColour: z.string().trim().regex(/^#[0-9a-fA-F]{6}$|^$/, "A hex colour, like #17F9F1.").default(""),
});
export type BrandEditable = z.infer<typeof brandEditableSchema>;

export const brandSettingsSchema = z.object({
  paintgroup: brandEditableSchema.default({ domain: "", phoneDisplay: "", legalLine: "", primaryColour: "" }),
  painthome: brandEditableSchema.default({ domain: "", phoneDisplay: "", legalLine: "", primaryColour: "" }),
});
export type BrandSettings = z.infer<typeof brandSettingsSchema>;

export const EMPTY_BRAND_SETTINGS: BrandSettings = {
  paintgroup: { domain: "", phoneDisplay: "", legalLine: "", primaryColour: "" },
  painthome: { domain: "", phoneDisplay: "", legalLine: "", primaryColour: "" },
};

/** Tolerant: an older or partial row still renders; garbage renders the defaults. */
export function parseBrandSettings(value: unknown): BrandSettings {
  const r = brandSettingsSchema.safeParse(value ?? {});
  return r.success ? r.data : EMPTY_BRAND_SETTINGS;
}

/** The brand for an audience: the defaults with the saved fields laid over them. */
export function brandFor(audience: Audience, settings: BrandSettings = EMPTY_BRAND_SETTINGS): Brand {
  const key = brandKeyOf(audience);
  const base = BRAND_DEFAULTS[key];
  const e = settings[key];
  const domain = e.domain || base.domain;
  const phoneDisplay = e.phoneDisplay || base.phoneDisplay;
  return {
    ...base,
    domain,
    url: `https://${domain}`,
    phoneDisplay,
    phoneTel: e.phoneDisplay ? telHref(phoneDisplay) : base.phoneTel,
    legalLine: e.legalLine || base.legalLine,
    primaryColour: HEX.test(e.primaryColour) ? e.primaryColour : base.primaryColour,
    localBusinessId: key === "painthome" ? `https://${domain}/#business` : base.localBusinessId,
  };
}

/** `with Paint Group since 2024` / `painting with us since 2024`. */
export function sinceLine(brand: Pick<Brand, "sinceTemplate">, year: string): string {
  return brand.sinceTemplate.replace("{year}", year);
}

/**
 * The part of a brand a client component needs (the phone link, the
 * hand-off tag) — handed through AudienceProvider. Plain data, no functions.
 */
export type BrandView = Pick<Brand, "key" | "name" | "phoneDisplay" | "phoneTel" | "hoursLine">;
export const brandView = (b: Brand): BrandView => ({ key: b.key, name: b.name, phoneDisplay: b.phoneDisplay, phoneTel: b.phoneTel, hoursLine: b.hoursLine });
