/**
 * The intake pipeline — one run per document, whatever the door. SERVER ONLY,
 * service-role: read → match → propose via cost_intake_set_extraction. The
 * duplicate guard lives in the SQL function so every door shares it.
 *
 * Extraction is behind an interface: the rule reader always runs; the AI
 * reader proposes on top when a key exists (readBill). AI proposes only —
 * nothing here confirms anything.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readBill } from "./extractBill";
import { hasApiKey } from "@/lib/extract/model";
import { isReadable, mergeExtractions, ruleExtract } from "./rules";
import { matchJob, type MatchJob, type MatchVendor } from "./match";
import type { ExtractedBill } from "./intake";

export type PipelineInput = {
  intakeId: string;
  docBytes: Uint8Array | null;
  bodyText: string;
  fromEmail: string;
  subject: string;
};

type WoRow = {
  id: string;
  job_no: number | null;
  wo_ref: string;
  wo_snapshot: { jobAddress?: string } | null;
  estimates: { sent_snapshot: { jobAddress?: string } | null } | null;
};

export async function loadMatchContext(
  service: SupabaseClient,
): Promise<{ jobs: MatchJob[]; vendors: MatchVendor[] }> {
  const [wos, vendorRows] = await Promise.all([
    service
      .from("work_orders")
      .select("id, job_no, wo_ref, wo_snapshot, estimates(sent_snapshot)")
      .neq("stage", "closed")
      .order("created_at", { ascending: false })
      .limit(200),
    service.from("vendors").select("id, name, sender_domains, extraction_hints"),
  ]);
  const jobs: MatchJob[] = ((wos.data ?? []) as unknown as WoRow[]).map((w) => ({
    woId: w.id,
    jobNo: w.job_no,
    woRef: w.wo_ref,
    address:
      (w.wo_snapshot?.jobAddress ?? w.estimates?.sent_snapshot?.jobAddress ?? "").toString(),
  }));
  const vendors: MatchVendor[] = (vendorRows.data ?? []).map(
    (v: { id: string; name: string; sender_domains: string[] | null }) => ({
      id: v.id,
      name: v.name,
      senderDomains: v.sender_domains ?? [],
    }),
  );
  return { jobs, vendors };
}

/** Run extraction + matching for one intake row and record the proposal. */
export async function runIntakePipeline(
  service: SupabaseClient,
  input: PipelineInput,
): Promise<{ ok: boolean; result: string }> {
  const { jobs, vendors } = await loadMatchContext(service);

  const rules = ruleExtract(`${input.subject}\n${input.bodyText}`, input.fromEmail, input.subject);

  // Vendor memory pre-AI: a known sender's extraction_hints ride the prompt.
  const domain = input.fromEmail.split("@")[1]?.toLowerCase() ?? "";
  let vendorHints: Record<string, unknown> | null = null;
  if (domain) {
    const { data } = await service
      .from("vendors")
      .select("extraction_hints")
      .contains("sender_domains", [domain])
      .limit(1)
      .maybeSingle();
    const hints = data?.extraction_hints;
    if (hints && typeof hints === "object") vendorHints = hints as Record<string, unknown>;
  }

  let ai: ExtractedBill | null = null;
  let model: string | null = null;
  let promptVersion: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let costCents: number | null = null;
  let aiError: string | null = null;

  if (hasApiKey() && (input.docBytes || input.bodyText.trim())) {
    const read = await readBill(input.docBytes, input.bodyText, vendorHints);
    if (read.ok) {
      ai = read.extraction;
      model = read.model;
      promptVersion = read.promptVersion;
      inputTokens = read.inputTokens;
      outputTokens = read.outputTokens;
      costCents = read.costCents;
    } else {
      aiError = read.message;
    }
  }

  const merged = mergeExtractions(rules, ai);
  const readable = isReadable(merged);
  if (!readable) {
    merged.error = aiError ?? "Couldn't read this document — open it and enter the details.";
  }

  const proposal = matchJob(merged, input.bodyText, input.fromEmail, jobs, vendors);

  const { data, error } = await service.rpc("cost_intake_set_extraction", {
    p_id: input.intakeId,
    p_extract_status: readable ? "extracted" : "failed",
    p_extracted: merged,
    p_model: model,
    p_prompt_version: promptVersion,
    p_input_tokens: inputTokens,
    p_output_tokens: outputTokens,
    p_cost_cents: costCents,
    p_proposed_wo: proposal.woId,
    p_proposed_vendor: proposal.vendorId,
    p_match_reason: proposal.reason,
  });
  if (error) return { ok: false, result: error.message };
  return { ok: true, result: String(data ?? "") };
}
