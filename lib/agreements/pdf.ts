import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderHtmlToPdf } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { loadAgreementRules, loadAgreementVersion } from "./load";
import { renderAgreementPdfHtml } from "./render";
import { MERGE_FIELDS, type MergeValues } from "./source";

/**
 * SERVER ONLY — the signed agreement's PDF (brief §4, §6). Rendered ONCE from
 * the same renderer the contractor read, with the snapshot the RPC took at
 * signing (`merged`), the contractor's drawn signature from the bucket, the
 * company signature image when one is in private storage (never the repo),
 * and the audit footer. Stored beside their insurance in `contractor-docs`
 * and attached through `agreement_attach_pdf`, which refuses a second write:
 * a failed render is retried by the next call, a succeeded one is never
 * replaced.
 */

export const BUCKET = "contractor-docs";
export const COMPANY_SIGNATURE_PATH = "company/signature-tom.png";

type Row = {
  id: string; contractor_id: string; version: number | null; source: string; status: string; merged: Record<string, unknown>;
  signed_name: string; signature: string | null; signed_at: string; signed_ip: string | null; signed_user_agent: string; body_sha256: string | null;
  countersigned_name: string | null; countersigned_at: string | null; pdf_path: string | null;
};

async function dataUrlFor(service: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await service.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return `data:image/png;base64,${buf.toString("base64")}`;
}

const melbourne = (iso: string) => new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });

/** The PDF path for a signed row, or null with the reason reported. Idempotent: an attached path is returned untouched. */
export async function ensureAgreementPdf(service: SupabaseClient, agreementId: string): Promise<{ path: string | null; companySignature: "image" | "typed" | null; error: string | null }> {
  try {
    const { data, error } = await service.from("contractor_agreements").select("id, contractor_id, version, source, status, merged, signed_name, signature, signed_at, signed_ip, signed_user_agent, body_sha256, countersigned_name, countersigned_at, pdf_path").eq("id", agreementId).maybeSingle();
    if (error) throw error;
    const row = data as Row | null;
    if (!row) return { path: null, companySignature: null, error: "not_found" };
    if (row.pdf_path) return { path: row.pdf_path, companySignature: null, error: null };
    if (row.source !== "portal" || !row.version || !row.signature || !row.body_sha256) return { path: null, companySignature: null, error: "not_a_portal_signature" };

    const v = await loadAgreementVersion(service, row.version);
    if (!v.file) throw new Error(v.error);
    const rules = await loadAgreementRules(service);
    const contractorSig = await dataUrlFor(service, row.signature);
    if (!contractorSig) throw new Error(`signature image missing at ${row.signature}`);
    const companySig = await dataUrlFor(service, COMPANY_SIGNATURE_PATH);
    // No image in storage yet: the countersignature is typed, and the footer says so.
    const companySignature = companySig ?? typedSignature(row.countersigned_name ?? `${rules.signatoryName}, ${rules.signatoryTitle}`);

    const values: MergeValues = {};
    for (const f of MERGE_FIELDS) {
      const m = row.merged[f];
      if (typeof m === "string" && m.trim()) values[f] = m;
    }
    values["contractor.signature"] = contractorSig;
    values["company.signature"] = companySignature;

    const html = renderAgreementPdfHtml(v.file, values, {
      version: row.version, signedAtMelbourne: melbourne(row.signed_at), ip: row.signed_ip ?? "", userAgent: row.signed_user_agent, bodySha256: row.body_sha256,
      countersignLine: `Countersigned for ENLVN Pty Ltd by ${row.countersigned_name ?? rules.signatoryName}${row.countersigned_at ? `, ${melbourne(row.countersigned_at)} (Melbourne)` : ""}${companySig ? "" : " — signature applied as typed text"}`,
    });
    const pdf = await renderHtmlToPdf(html);
    const stamp = row.signed_at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const path = `${row.contractor_id}/agreements/v${row.version}-${stamp}.pdf`;
    const up = await service.storage.from(BUCKET).upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(up.error.message);
    const { data: att, error: attErr } = await service.rpc("agreement_attach_pdf", { p_agreement_id: agreementId, p_path: path });
    if (attErr) throw attErr;
    const word = String(att ?? "");
    if (word !== "ok:attached" && word !== "error:pdf_immutable") throw new Error(word);
    return { path, companySignature: companySig ? "image" : "typed", error: null };
  } catch (e) {
    reportError(e, { where: "agreements.ensurePdf", extra: { agreementId } });
    return { path: null, companySignature: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A countersignature drawn as text, for the day before the company signature image is in storage. */
export function typedSignature(name: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="48"><text x="4" y="32" font-family="'Snell Roundhand','Brush Script MT','Segoe Script',cursive" font-size="24" fill="#111">${name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** A short-lived signed URL for a stored agreement document (the bucket is private). */
export async function agreementDocUrl(service: SupabaseClient, path: string, expiresInSeconds = 600): Promise<string | null> {
  const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) { reportError(error, { where: "agreements.docUrl", extra: { path } }); return null; }
  return data?.signedUrl ?? null;
}
