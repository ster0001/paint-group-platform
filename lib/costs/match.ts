/**
 * The matching ladder (§2.3), in strict order:
 *   1. exact order reference (PG-<job no> / WO-<ref>) — deterministic, never
 *      degrades as PG refs propagate onto supplier accounts;
 *   2. address fuzzy-match against active jobs — needs the street number AND
 *      a street-name token, and exactly ONE job may win;
 *   3. vendor memory — a sender domain seen before prefills the vendor
 *      (the job stays proposed-or-unmatched);
 *   4. unmatched.
 * Pure and unit-tested. AI proposes, this ladder proposes — a person confirms.
 */

import type { ExtractedBill, MatchReason } from "./intake";

export type MatchJob = {
  woId: string;
  jobNo: number | null;
  woRef: string;
  address: string;
};

export type MatchVendor = {
  id: string;
  name: string;
  senderDomains: readonly string[];
};

export type MatchProposal = {
  woId: string | null;
  vendorId: string | null;
  reason: MatchReason;
};

const NOISE = new Set([
  "st", "street", "rd", "road", "ave", "avenue", "gr", "grove", "cres",
  "crescent", "ct", "court", "dr", "drive", "pl", "place", "ln", "lane",
  "hwy", "highway", "tce", "terrace", "vic", "nsw", "qld", "sa", "wa", "tas",
  "unit", "lot", "level",
]);

function addressTokens(raw: string): { numbers: string[]; words: string[] } {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s\/]/g, " ")
    .split(/[\s\/]+/)
    .filter(Boolean);
  return {
    numbers: tokens.filter((t) => /^\d{1,5}[a-z]?$/.test(t)),
    words: tokens.filter((t) => /^[a-z]{3,}$/.test(t) && !NOISE.has(t)),
  };
}

/** True when the candidate text names this job's street number AND street. */
function addressHits(candidate: string, jobAddress: string): boolean {
  if (!candidate.trim() || !jobAddress.trim()) return false;
  const c = addressTokens(candidate);
  const j = addressTokens(jobAddress);
  if (j.numbers.length === 0 || j.words.length === 0) return false;
  const numberHit = j.numbers.some((n) => c.numbers.includes(n));
  const wordHit = j.words.some((w) => c.words.includes(w));
  return numberHit && wordHit;
}

export function matchJob(
  extracted: ExtractedBill,
  fullText: string,
  fromEmail: string,
  jobs: readonly MatchJob[],
  vendors: readonly MatchVendor[],
): MatchProposal {
  const domain = fromEmail.split("@")[1]?.toLowerCase() ?? "";
  const memoryVendor =
    vendors.find((v) => domain !== "" && v.senderDomains.includes(domain)) ?? null;

  // 1. Exact order reference — from the extracted ref and every hint.
  const refs = new Set<string>(
    [extracted.order_ref, ...(extracted.job_hints ?? [])]
      .filter((r): r is string => Boolean(r))
      .map((r) => r.toUpperCase()),
  );
  for (const ref of refs) {
    const pg = ref.match(/^PG-0*(\d{1,6})$/);
    if (pg) {
      const jobNo = Number(pg[1]);
      const hit = jobs.find((j) => j.jobNo === jobNo);
      if (hit) return { woId: hit.woId, vendorId: memoryVendor?.id ?? null, reason: "order_ref" };
    }
    const hit = jobs.find((j) => j.woRef.toUpperCase() === ref);
    if (hit) return { woId: hit.woId, vendorId: memoryVendor?.id ?? null, reason: "order_ref" };
  }

  // 2a. The supplier's REFERENCE field as an address (current practice puts
  //     the job street there, often without a number — "LESLIE ST" on a real
  //     Haymes invoice). A short deliberate field may match on street name
  //     alone, but only when exactly ONE job carries that street.
  for (const cand of [extracted.order_ref, ...(extracted.job_hints ?? [])]) {
    if (!cand || cand.length > 40) continue;
    const c = addressTokens(cand);
    if (c.words.length === 0) continue;
    const hits = jobs.filter((j) => {
      const jt = addressTokens(j.address);
      const wordHit = c.words.every((w) => jt.words.includes(w));
      if (!wordHit) return false;
      // When the reference DOES carry a number, it must agree.
      return c.numbers.length === 0 || c.numbers.some((n) => jt.numbers.includes(n));
    });
    if (hits.length === 1) {
      return { woId: hits[0].woId, vendorId: memoryVendor?.id ?? null, reason: "address" };
    }
  }

  // 2b. Address — the extracted address first, the whole text as fallback;
  //     exactly one job may claim it, or nothing is proposed.
  for (const candidate of [extracted.address_text ?? "", fullText]) {
    if (!candidate.trim()) continue;
    const hits = jobs.filter((j) => addressHits(candidate, j.address));
    if (hits.length === 1) {
      return { woId: hits[0].woId, vendorId: memoryVendor?.id ?? null, reason: "address" };
    }
    if (hits.length > 1) break; // ambiguous — never guess between jobs
  }

  // 3. Vendor memory — the vendor prefills; the job stays unmatched.
  if (memoryVendor) return { woId: null, vendorId: memoryVendor.id, reason: "vendor_memory" };

  return { woId: null, vendorId: null, reason: "none" };
}
