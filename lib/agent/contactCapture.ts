/**
 * The website chat asks for contact details (Tom, 26 Nov 2026: "auto add ai to
 * ask for contact details … important if we are offline"). Pure, client-safe.
 *
 * A visitor can answer in the chat's own little form, or just type them into a
 * message — "it's jo@example.com, 0412 345 678". This reads the second case:
 * the customer's own lines only, an email and an Australian phone number, both
 * or nothing. The name is whatever the form gave, or nothing (the account is
 * found or made by email/phone either way).
 */
export type CapturedContact = { email: string; phone: string };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** An Australian number: 0X XXXX XXXX or +61 X XXXX XXXX, any spacing, dashes or brackets. Normalised to 0XXXXXXXXX. */
export function findAuPhone(text: string): string | null {
  const runs = text.match(/[+(]?\d[\d\s().-]{7,18}\d/g) ?? [];
  for (const run of runs) {
    let d = run.replace(/\D/g, "");
    if (d.startsWith("61") && d.length === 11) d = `0${d.slice(2)}`;
    if (/^0[23478]\d{8}$/.test(d)) return d;
  }
  return null;
}

export function findEmail(text: string): string | null {
  const m = text.match(EMAIL);
  return m ? m[0].replace(/[.]+$/, "").toLowerCase() : null;
}

/** Across the customer's lines: the latest email and the latest phone, or null unless both are there. */
export function extractContact(lines: string[]): CapturedContact | null {
  let email: string | null = null;
  let phone: string | null = null;
  for (const line of lines) {
    email = findEmail(line) ?? email;
    // An email's digits are not a phone number.
    phone = findAuPhone(line.replace(EMAIL, " ")) ?? phone;
  }
  return email && phone ? { email, phone } : null;
}
