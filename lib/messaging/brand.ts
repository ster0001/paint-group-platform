import { brandFor, type Brand } from "@/lib/marketing/brand";
import type { CompanyForMessages } from "./load";

/**
 * Paint Home brief §5 (lead and account data) — ONE brand parameter for the
 * messaging adapter, never a second template set. Every customer-facing
 * message is built from the company profile (`loadMessaging().company`) and
 * the templates' `{{company_name}}`; a Paint Home estimate, job or invoice
 * passes its `brand` column through here first, so the same template
 * renders "Paint Home", the Paint Home mark and the Paint Home address with
 * no change to its words. Paint Group rows pass through untouched.
 *
 * Pure and client-safe (no Supabase); the callers are the send sites.
 */
export type MessageBrand = "paintgroup" | "painthome";

/** A row's `brand` column (or anything else) → a brand; Paint Group is the default. */
export function messageBrandOf(v: unknown): MessageBrand {
  return v === "painthome" ? "painthome" : "paintgroup";
}

/** The Paint Home mark for emails: a PNG with its own slate background (Tom, 24 Sep: transparent logos invert in dark-mode mail clients), served by the app itself. */
export const PAINTHOME_EMAIL_LOGO_PATH = "/painthome/email-logo.png";
/** The mark for light surfaces (the white estimate card): transparent, ink lettering (Tom, 25 Oct 2026). */
export const PAINTHOME_LIGHT_LOGO_PATH = "/painthome/logo-light.png";

export function brandRecord(brand: MessageBrand): Brand {
  return brandFor(brand === "painthome" ? "painthome" : "home");
}

/**
 * The company a message is from. Paint Home replaces the name, the phone
 * and every logo field; the estimator, the email and the address stay the
 * company's (they are the same people and the same office).
 */
export function companyForBrand<T extends CompanyForMessages>(company: T, brand: MessageBrand): T {
  if (brand !== "painthome") return company;
  const b = brandRecord(brand);
  const logo = `${b.url}${PAINTHOME_EMAIL_LOGO_PATH}`;
  return { ...company, name: b.name, phone: b.phoneDisplay, logoUrl: logo, logoUrlLight: `${b.url}${PAINTHOME_LIGHT_LOGO_PATH}`, logoUrlEmail: logo };
}

/**
 * The From header. The sending domain stays the one verified with Resend
 * (EMAIL_FROM's mailbox); Paint Home changes the DISPLAY name only — a
 * Paint Home sender domain is ⚑ for Tom (verify painthome.com.au in Resend).
 * Paint Group returns undefined: the sender keeps its configured default.
 */
export function fromForBrand(brand: MessageBrand, configured: string | undefined = process.env.EMAIL_FROM): string | undefined {
  if (brand !== "painthome") return undefined;
  const m = (configured ?? "").match(/<([^>]+)>/);
  const address = m?.[1]?.trim() || (configured ?? "").trim() || "email@paintgroup.com.au";
  return `${brandRecord(brand).name} <${address}>`;
}

/** The public origin a brand's links start with: Paint Home's own domain (the whole app answers there — brief ⚑ P5), else the platform's. */
export function publicOriginFor(brand: MessageBrand, platformOrigin: string): string {
  return brand === "painthome" ? brandRecord(brand).url : platformOrigin.replace(/\/+$/, "");
}

/**
 * The invoicing entity block (Settings → Invoicing → Entity) as a brand's
 * document shows it: Paint Home trades as Paint Home with the Enlvn legal
 * line (brief §2); the ABN, address and bank details are the one company's
 * and are kept. Paint Group's block is whatever the office configured.
 */
export function entityForBrand<T extends Record<string, string>>(entity: T, brand: MessageBrand): T {
  if (brand !== "painthome") return entity;
  const b = brandRecord(brand);
  return { ...entity, tradingName: b.name, brandSub: b.tagline, legalLine: b.legalLine };
}
