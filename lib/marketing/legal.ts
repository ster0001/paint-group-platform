import type { Brand } from "./brand";

/**
 * The public legal pages (/privacy, /terms, /warranty), per brand (go-live
 * check, 25 Nov 2026 — the footer's three links pointed at `#`). Pure and
 * client-safe.
 *
 * Privacy: Tom, 25 Nov 2026 — "reword Paint Group's". The sections below
 * carry the same commitments as paintgroup.com.au/privacy-policy, in this
 * site's words, with the brand's own name and contact details, plus the
 * things this platform does that the old site did not (the texted code, the
 * saved estimate, the cookie choice). ⚑ Not legally reviewed.
 *
 * Terms: the one set in Settings → Terms & conditions (the same words every
 * estimate shows below its accept panel) — `termsForBrand` only swaps the
 * trading name. Warranty: lib/warranty/terms.ts, never retyped here.
 */
export const PRIVACY_VERSION = "2026-11-25";

export type LegalParty = { tradingName: string; legalLine: string; abn: string; address: string; phone: string; email: string };
export type LegalSection = { heading: string; paragraphs: string[]; bullets?: string[] };

/** The company behind a brand's legal pages: the brand's name and contact, the one company's ABN and address. */
export function legalPartyFor(brand: Pick<Brand, "name" | "legalLine" | "phoneDisplay" | "email">, company: { abn?: string; addressLine1?: string; addressLine2?: string }): LegalParty {
  return {
    tradingName: brand.name,
    legalLine: brand.legalLine || "ENLVN Pty Ltd trading as Paint Group",
    abn: (company.abn ?? "").trim(),
    address: [company.addressLine1, company.addressLine2].map((s) => (s ?? "").trim()).filter(Boolean).join(", "),
    phone: brand.phoneDisplay,
    email: brand.email,
  };
}

export function privacySections(p: LegalParty): LegalSection[] {
  const n = p.tradingName;
  return [
    {
      heading: "Who we are",
      paragraphs: [
        `${n} is a painting business in Melbourne${p.legalLine ? ` (${p.legalLine}${p.abn ? `, ABN ${p.abn}` : ""})` : ""}. This policy explains what personal information we collect through this website and while we quote for and carry out your job, and what we do with it.`,
      ],
    },
    {
      heading: "What we collect",
      paragraphs: ["We collect only what we need to price and deliver your painting:"],
      bullets: [
        "Your name, mobile number, email address and the address of the property.",
        "Details of the job: your answers in the online estimate, room sizes, photos, floorplans and any messages you send us.",
        "Records of your estimates, bookings, invoices and payments. Card details are handled by our payment provider and are not stored by us.",
        "How the website is used, through cookies and analytics, where you have allowed them.",
      ],
    },
    {
      heading: "How we collect it",
      paragraphs: [
        "Most of it comes directly from you: when you build an estimate online, when you call, email or message us, and when you engage us for work. When you enter your mobile number we text you a one-time code to confirm it is yours. Website usage information is collected automatically when you visit, subject to your cookie choice.",
      ],
    },
    {
      heading: "Why we collect it",
      paragraphs: ["We use your information to:"],
      bullets: [
        "Prepare, save and send your estimate, and answer your questions about it.",
        "Contact you about your estimate. We may call, text or email you to confirm details or the price.",
        "Schedule and carry out the work, and keep you updated while it is under way.",
        "Issue invoices and take payment.",
        "Ask for your feedback once the job is finished.",
        "Improve this website and our service.",
        "Send you news and offers, only where you have agreed. Every marketing message tells you how to opt out.",
      ],
    },
    {
      heading: "Who we share it with",
      paragraphs: [
        "We share your information only as far as the job needs it: with the painters assigned to your job (who see your first name, phone number, address and the scope of work), and with the companies that provide our website hosting, email and text messaging, payments and analytics. Some of these providers store data outside Australia.",
        "We do not sell personal information. We may disclose it where the law requires us to.",
      ],
    },
    {
      heading: "Cookies and analytics",
      paragraphs: [
        "This site uses a small number of cookies that are needed for it to work, such as the one that saves your estimate so you can come back to it. Analytics and advertising measurement load only if you choose \u201cAllow analytics\u201d. You can change your choice at any time using \u201cCookie settings\u201d at the foot of any page, and the site works either way.",
      ],
    },
    {
      heading: "Storage and security",
      paragraphs: [
        "We take reasonable steps to protect your information from misuse, loss and unauthorised access. We keep it for as long as it is needed for the purposes above, or for as long as the law requires, and then delete or de-identify it.",
      ],
    },
    {
      heading: "Seeing or correcting your information",
      paragraphs: [
        `You can ask for a copy of the personal information we hold about you, or ask us to correct or delete it, by contacting us${p.email ? ` at ${p.email}` : ""}. We will respond within a reasonable time.`,
      ],
    },
    {
      heading: "Complaints",
      paragraphs: [
        "If you have a concern about how we have handled your information, please tell us first so we can put it right. If you are not satisfied with our response, you can contact the Office of the Australian Information Commissioner at oaic.gov.au.",
      ],
    },
    {
      heading: "Contact us",
      paragraphs: [
        [p.legalLine || n, p.abn ? `ABN ${p.abn}` : "", p.address, p.phone, p.email].filter(Boolean).join(" \u00b7 "),
        "We may update this policy from time to time. The current version is always on this page.",
      ],
    },
  ];
}

/** The estimate terms as this brand shows them: the same words, the brand's trading name. Blank lines separate paragraphs. */
export function termsForBrand(terms: string, brand: Pick<Brand, "key" | "name">): string[] {
  const text = brand.key === "painthome" ? terms.replace(/Paint Group/g, brand.name).replace(/PAINT GROUP/g, brand.name.toUpperCase()) : terms;
  return text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}
