/**
 * The PaintScout QUOTE share page, read as text (Tom, 4 Nov 2026: "add this
 * property into estimates from Paint Scout … the pricing updated based on the
 * new system pricing, and it is editable").
 *
 * Only the facts the work order does not carry are read here: who the
 * customer is, where the job is, what the quote leaves out, and PaintScout's
 * own total (kept for comparison, never used as a price). The scope comes
 * from the work order (lib/import/booked/workorder-text.ts).
 *
 * The page prints, after the company letterhead:
 *
 *   "Contact" ↵ name ↵ [second name] ↵ [company] ↵ [street] ↵ "Suburb, VIC 3004"
 *             ↵ email … ↵ phone …
 *   "Job Address" ↵ street ↵ "Suburb, VIC 3183"
 *   "Estimate ID" ↵ "2474"
 *   … "Exclusions" ↵ intro line ↵ item ↵ item … ↵ "Client Responsibilities"
 *   … "Estimate Total" ↵ "$17,802.11"   (near the top)
 *
 * Every field is best-effort: what cannot be read stays blank, and the
 * import prints what it read so a person confirms it before anything is
 * written.
 */
export type QuoteFacts = {
  quoteNo: string | null;
  /** People named under Contact, in page order (the first is the main contact). */
  names: string[];
  company: string;
  emails: string[];
  phones: string[];
  /** The contact's postal address (often a body corporate's office), when printed. */
  contactAddress: { street: string; suburb: string; state: string; postcode: string } | null;
  jobAddress: { street: string; suburb: string; state: string; postcode: string } | null;
  exclusions: string[];
  /** PaintScout's "Estimate Total" in cents, for the comparison line only. */
  totalCents: number | null;
};

const lineSuburbRe = /^(.+?),\s*(VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\s+(\d{4})$/i;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRe = /^\+?[\d\s()-]{8,}$/;
const companyRe = /\b(pty|ltd|limited|management|corporate|corporation|corp|strata|owners|body|group|holdings|trust|council|services|realty|real estate)\b/i;
const moneyRe = /^\$([\d,]+(?:\.\d{1,2})?)$/;

const toCents = (s: string): number => Math.round(Number(s.replace(/,/g, "")) * 100);

export function parseQuoteText(text: string): QuoteFacts {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/ /g, " ").trim()).filter((l) => l.length > 0);
  const at = (re: RegExp, from = 0) => {
    for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
    return -1;
  };

  const idIdx = at(/^Estimate ID$/i);
  const quoteNo = idIdx >= 0 && /^\d+$/.test(lines[idIdx + 1] ?? "") ? lines[idIdx + 1] : null;

  const totIdx = at(/^Estimate Total$/i);
  const tm = totIdx >= 0 ? (lines[totIdx + 1] ?? "").match(moneyRe) : null;
  const totalCents = tm ? toCents(tm[1]) : null;

  // Contact block: from the SECOND "Contact" heading (the first can be a menu)
  // that is followed by a person, up to "Job Address".
  const names: string[] = [];
  const emails: string[] = [];
  const phones: string[] = [];
  let company = "";
  let contactAddress: QuoteFacts["contactAddress"] = null;
  const jobIdx = at(/^Job Address$/i);
  let cIdx = -1;
  for (let i = 0; i < (jobIdx >= 0 ? jobIdx : lines.length); i++) if (/^Contact$/i.test(lines[i])) cIdx = i;
  if (cIdx >= 0 && jobIdx > cIdx) {
    const block = lines.slice(cIdx + 1, jobIdx);
    let pendingStreet = "";
    for (const l of block) {
      const sub = l.match(lineSuburbRe);
      if (sub) {
        contactAddress = { street: pendingStreet, suburb: sub[1].trim(), state: sub[2].toUpperCase(), postcode: sub[3] };
        pendingStreet = "";
        continue;
      }
      if (emailRe.test(l)) { emails.push(l.toLowerCase()); continue; }
      if (phoneRe.test(l) && l.replace(/\D/g, "").length >= 8) { phones.push(l); continue; }
      if (/^\d/.test(l)) { pendingStreet = l; continue; } // a street starts with its number
      if (companyRe.test(l) && !company) { company = l; continue; }
      names.push(l);
    }
  }

  let jobAddress: QuoteFacts["jobAddress"] = null;
  if (jobIdx >= 0) {
    const street = lines[jobIdx + 1] ?? "";
    const sub = (lines[jobIdx + 2] ?? "").match(lineSuburbRe);
    if (street && sub) jobAddress = { street, suburb: sub[1].trim(), state: sub[2].toUpperCase(), postcode: sub[3] };
  }

  // Exclusions: the lines after the heading's intro, up to the next heading.
  const exclusions: string[] = [];
  const exIdx = at(/^Exclusions$/i);
  if (exIdx >= 0) {
    for (let i = exIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^(Client Responsibilities|Special Equipment|Colour Samples|Sub ?Total|Total)\b/i.test(l)) break;
      if (/^(please|here are|the following)\b.*:?$/i.test(l) || /excluded from the quote/i.test(l)) continue;
      if (l.length > 120) break; // a paragraph, not a list item
      exclusions.push(l);
    }
  }

  return { quoteNo, names, company, emails, phones, contactAddress, jobAddress, exclusions, totalCents };
}
