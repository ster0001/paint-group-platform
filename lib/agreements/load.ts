import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { sha256Hex } from "./hash";
import { renderAgreementFragment, SIGNING_FIELDS } from "./render";
import { formatAbn, parseAgreement, PROFILE_FIELDS, type AgreementFile, type MergeField, type MergeValues } from "./source";
import { mergeAgreementRules, parseAgreementStatus, type AgreementRules, type AgreementStatus } from "./status";

/**
 * SERVER ONLY — the reads behind the agreement screens. Every read keeps its
 * error (CLAUDE.md: a list read that drops its error renders as "nothing
 * here"). The version row is parsed through the same parser the seed used,
 * so the page and the PDF render the words the table holds, never the file
 * on disk.
 */

export type AgreementVersionRow = { version: number; title: string; effective_from: string; body_md: string; body_sha256: string };

/** The current (or a named) version, parsed. */
export async function loadAgreementVersion(db: SupabaseClient, version?: number | null): Promise<{ file: AgreementFile; row: AgreementVersionRow } | { file: null; row: null; error: string }> {
  let q = db.from("agreement_versions").select("version, title, effective_from, body_md, body_sha256");
  q = version ? q.eq("version", version) : q.lte("effective_from", new Date().toISOString().slice(0, 10)).order("version", { ascending: false }).limit(1);
  const { data, error } = await q;
  if (error) return { file: null, row: null, error: error.code === "42P01" ? "The agreement is not switched on yet (migration 20270284)." : error.message };
  const row = ((data ?? []) as AgreementVersionRow[])[0];
  if (!row) return { file: null, row: null, error: "No agreement version is seeded yet (scripts/seed-agreement.ts)." };
  try {
    return { file: parseAgreement(row.body_md), row };
  } catch (e) {
    return { file: null, row: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The signed-in contractor's (or, for staff, any contractor's) agreement status. */
export async function loadAgreementStatus(db: SupabaseClient, contractorId?: string | null): Promise<{ status: AgreementStatus | null; error: string | null }> {
  const { data, error } = await db.rpc("agreement_status", contractorId ? { p_contractor_id: contractorId } : {});
  if (error) return { status: null, error: error.code === "42883" ? "The agreement is not switched on yet (migration 20270285)." : error.message };
  return { status: parseAgreementStatus(data), error: null };
}

/** The rules row, or the defaults; a refused read is reported, never silently defaulted. */
export async function loadAgreementRules(db: SupabaseClient): Promise<AgreementRules> {
  const { data, error } = await db.from("settings").select("value").eq("key", "agreement_rules").maybeSingle();
  if (error) reportError(error, { where: "agreements.loadRules" });
  return mergeAgreementRules((data as { value: unknown } | null)?.value);
}

export type ContractorForAgreement = { company_name: string | null; abn: string | null; address: string | null };

/** The values the preview prints from the record, before signing. Signing-time fields stay unresolved (pending). */
export function previewValues(c: ContractorForAgreement, term: Pick<AgreementStatus, "commencementOn" | "nextExpiresOn">, rules: AgreementRules): MergeValues {
  return {
    "contractor.company_name": (c.company_name ?? "").trim(),
    "contractor.abn": formatAbn(c.abn ?? ""),
    "contractor.address": (c.address ?? "").trim(),
    "company.signatory_name": `${rules.signatoryName}, ${rules.signatoryTitle}`,
    "agreement.commencement_on": term.commencementOn ?? "",
    "agreement.expires_on": term.nextExpiresOn ?? "",
  };
}

/** The profile fields the record leaves blank, in the words the Profile form uses. */
export function missingForAgreement(c: ContractorForAgreement, abnValid: (abn: string) => boolean): { field: MergeField; label: string }[] {
  const labels: Record<string, string> = { "contractor.company_name": "trading name", "contractor.abn": "a valid 11-digit ABN", "contractor.address": "business address" };
  const values = previewValues(c, { commencementOn: "x", nextExpiresOn: "x" }, mergeAgreementRules(null));
  return PROFILE_FIELDS.filter((f) => !(values[f] ?? "").trim() || (f === "contractor.abn" && !abnValid(values[f] ?? ""))).map((f) => ({ field: f, label: labels[f] }));
}

/**
 * The hash that names what the contractor read: the preview fragment (their
 * record in place, the signing slots pending), so a profile edit between
 * reading and signing changes it and the sign action refuses. The same
 * string goes in the PDF footer and on the row (`body_sha256`).
 */
export function wordingHash(file: AgreementFile, values: MergeValues): string {
  return sha256Hex(renderAgreementFragment(file, values, SIGNING_FIELDS));
}
