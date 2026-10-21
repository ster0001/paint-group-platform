/**
 * The subcontractor agreement as the screens read it (brief §4, §7, Step 2):
 * the one gate rule, the status shape the RPCs return, and the words. Pure.
 * `agreementGateOf` mirrors `agreement_gate_of` in migration 20270285 word
 * for word, so the gate in SQL and the line on every screen cannot disagree;
 * status.test.ts pins the cases. Shared by server and client code.
 */

/** new = signs before any offer; existing = on the books before the feature, offers flow until asked (ruling 14). */
export type AgreementKind = "new" | "existing";

export type AgreementGate = "ok" | "agreement_unsigned" | "agreement_expired";

export type AgreementGateInput = {
  kind: AgreementKind;
  /** settings.agreement_rules.offerGate — false turns the gate off entirely. */
  offerGate: boolean;
  /** agreement_current_version() is not null: a version is seeded and effective. */
  versionPublished: boolean;
  /** The status=signed row's expiry, or null when there is no signed row. `undefined` = no row. */
  signedExpiresOn: string | null | undefined;
  graceUntil: string | null;
};

/** `today` is the Melbourne calendar date, YYYY-MM-DD. */
export function agreementGateOf(i: AgreementGateInput, today: string, now: Date): AgreementGate {
  if (!i.offerGate) return "ok";
  if (!i.versionPublished) return "ok";
  if (i.signedExpiresOn !== undefined) {
    if (i.signedExpiresOn === null || i.signedExpiresOn >= today) return "ok";
    return "agreement_expired";
  }
  if (i.kind === "existing") {
    if (!i.graceUntil) return "ok";
    if (now.getTime() < new Date(i.graceUntil).getTime()) return "ok";
  }
  return "agreement_unsigned";
}

export const DEFAULT_AGREEMENT_RULES = { offerGate: true, graceDays: 14, renewalWarnDays: 30, termMonths: 12, signatoryName: "Tom Roman", signatoryTitle: "Director" } as const;

export type AgreementRules = { offerGate: boolean; graceDays: number; renewalWarnDays: number; termMonths: number; signatoryName: string; signatoryTitle: string };

export function mergeAgreementRules(raw: unknown): AgreementRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, d: number) => (Number.isInteger(v) && (v as number) >= 1 ? (v as number) : d);
  const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
  return {
    offerGate: typeof r.offerGate === "boolean" ? r.offerGate : DEFAULT_AGREEMENT_RULES.offerGate,
    graceDays: int(r.graceDays, DEFAULT_AGREEMENT_RULES.graceDays),
    renewalWarnDays: int(r.renewalWarnDays, DEFAULT_AGREEMENT_RULES.renewalWarnDays),
    termMonths: int(r.termMonths, DEFAULT_AGREEMENT_RULES.termMonths),
    signatoryName: str(r.signatoryName, DEFAULT_AGREEMENT_RULES.signatoryName),
    signatoryTitle: str(r.signatoryTitle, DEFAULT_AGREEMENT_RULES.signatoryTitle),
  };
}

// ---- the status a screen reads (agreement_status / agreement_statuses) ---------------------

export type SignedAgreement = {
  id: string;
  version: number | null;
  source: "portal" | "uploaded";
  signedAt: string;
  signedName: string;
  commencementOn: string | null;
  expiresOn: string | null;
  pdfPath: string | null;
  countersignedAt: string | null;
};

export type AgreementHistoryRow = { id: string; version: number | null; source: "portal" | "uploaded"; status: "signed" | "superseded"; signedAt: string; expiresOn: string | null; pdfPath: string | null };

export type AgreementStatus = {
  kind: AgreementKind;
  gate: AgreementGate;
  currentVersion: number | null;
  requestedAt: string | null;
  graceUntil: string | null;
  /** Schedule D for the next signature. */
  commencementOn: string | null;
  renewalWarnDays: number;
  signed: SignedAgreement | null;
  history: AgreementHistoryRow[];
};

const kindOf = (v: unknown): AgreementKind => (v === "existing" ? "existing" : "new");
const gateOf = (v: unknown): AgreementGate => (v === "agreement_unsigned" || v === "agreement_expired" ? v : "ok");
const sourceOf = (v: unknown): "portal" | "uploaded" => (v === "uploaded" ? "uploaded" : "portal");
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** The jsonb the RPC returns, shaped. Null in, null out. */
export function parseAgreementStatus(raw: unknown): AgreementStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = r.signed && typeof r.signed === "object" ? (r.signed as Record<string, unknown>) : null;
  const history: AgreementHistoryRow[] = Array.isArray(r.history) ? (r.history as Record<string, unknown>[]).map((h) => ({
    id: String(h.id ?? ""), version: int(h.version), source: sourceOf(h.source), status: h.status === "superseded" ? "superseded" : "signed",
    signedAt: str(h.signed_at) ?? "", expiresOn: str(h.expires_on), pdfPath: str(h.pdf_path),
  })) : [];
  return {
    kind: kindOf(r.kind), gate: gateOf(r.gate), currentVersion: int(r.current_version),
    requestedAt: str(r.requested_at), graceUntil: str(r.grace_until), commencementOn: str(r.commencement_on),
    renewalWarnDays: int(r.renewal_warn_days) ?? DEFAULT_AGREEMENT_RULES.renewalWarnDays,
    signed: s ? {
      id: String(s.id ?? ""), version: int(s.version), source: sourceOf(s.source), signedAt: str(s.signed_at) ?? "", signedName: str(s.signed_name) ?? "",
      commencementOn: str(s.commencement_on), expiresOn: str(s.expires_on), pdfPath: str(s.pdf_path), countersignedAt: str(s.countersigned_at),
    } : null,
    history,
  };
}

/** One row of agreement_statuses(), shaped. */
export type AgreementStatusRow = {
  contractorId: string; kind: AgreementKind; gate: AgreementGate; agreementId: string | null; version: number | null;
  source: "portal" | "uploaded" | null; signedAt: string | null; expiresOn: string | null; pdfPath: string | null; requestedAt: string | null; graceUntil: string | null;
};

export function parseAgreementStatusRow(raw: unknown): AgreementStatusRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.contractor_id !== "string") return null;
  return {
    contractorId: r.contractor_id, kind: kindOf(r.kind), gate: gateOf(r.gate), agreementId: str(r.agreement_id), version: int(r.version),
    source: r.source === "portal" || r.source === "uploaded" ? r.source : null, signedAt: str(r.signed_at), expiresOn: str(r.expires_on), pdfPath: str(r.pdf_path),
    requestedAt: str(r.requested_at), graceUntil: str(r.grace_until),
  };
}

// ---- derived facts ---------------------------------------------------------------------------

/** Days until the signed agreement expires, from a Melbourne date; null when nothing is signed or it never expires. */
export function daysUntilExpiry(expiresOn: string | null | undefined, today: string): number | null {
  if (!expiresOn) return null;
  return Math.round((Date.UTC(+expiresOn.slice(0, 4), +expiresOn.slice(5, 7) - 1, +expiresOn.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000);
}

/** The signed agreement is inside its renewal window (Schedule M, brief §3 Renewal) or past it. */
export function renewalDue(expiresOn: string | null | undefined, today: string, warnDays: number): boolean {
  const d = daysUntilExpiry(expiresOn, today);
  return d !== null && d <= warnDays;
}

// ---- words -----------------------------------------------------------------------------------

/** A Melbourne short date from an ISO date (YYYY-MM-DD, taken as that calendar day) or timestamp. */
export const dmy = (iso: string): string => {
  // A bare date is that day: midnight UTC is 10 or 11 in the morning in Melbourne, the same calendar day either way.
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00Z`) : new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Melbourne" });
};

/** The Documents card line for the painter. */
export function painterAgreementLine(s: Pick<AgreementStatus, "signed" | "gate" | "renewalWarnDays">, today: string): string {
  if (!s.signed) return s.gate === "agreement_unsigned" ? "Not signed · job offers wait until it is" : "Not signed";
  const base = `Signed ${dmy(s.signed.signedAt)}${s.signed.version ? ` · v${s.signed.version}` : " · signed on paper"}`;
  const days = daysUntilExpiry(s.signed.expiresOn, today);
  if (days !== null && days < 0) return `${base} · expired ${dmy(s.signed.expiresOn as string)}`;
  if (days !== null && days <= s.renewalWarnDays) return `${base} · due for renewal ${dmy(s.signed.expiresOn as string)}`;
  return base;
}

/** The Contractors list cell for the office. */
export function staffAgreementLine(r: Pick<AgreementStatusRow, "kind" | "gate" | "version" | "source" | "signedAt" | "expiresOn" | "requestedAt" | "graceUntil">, today: string, now: Date, warnDays: number): string {
  if (r.signedAt) {
    const what = r.source === "uploaded" ? "Uploaded" : `Signed v${r.version ?? "?"}`;
    const days = daysUntilExpiry(r.expiresOn, today);
    if (days !== null && days < 0) return `${what} · expired ${dmy(r.expiresOn as string)} · no offers`;
    if (days !== null && days <= warnDays) return `${what} · expires ${dmy(r.expiresOn as string)}`;
    return `${what} · ${dmy(r.signedAt)}`;
  }
  if (r.kind === "existing") {
    if (!r.requestedAt) return "Not signed · not asked yet";
    if (r.graceUntil && now.getTime() < new Date(r.graceUntil).getTime()) return `Not signed · asked ${dmy(r.requestedAt)}, offers stop ${dmy(r.graceUntil)}`;
    return `Not signed · asked ${dmy(r.requestedAt)} · no offers`;
  }
  return "Not signed · no offers";
}

/** What a gate word means on the office's screens. */
export function agreementGateWord(g: AgreementGate): string {
  return g === "agreement_unsigned" ? "Agreement not signed" : g === "agreement_expired" ? "Agreement expired" : "";
}
