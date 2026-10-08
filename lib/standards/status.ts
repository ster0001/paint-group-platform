import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { mergeStandardsRules, type StandardsRules, type StandardsStatus } from "./acks";

/**
 * Who has confirmed the standards — read through the RPCs of 20270225, which
 * hold the ONE rule (standards_status_of). Every read keeps its error.
 */

export type StandardsStatusRow = {
  contractorId: string;
  status: StandardsStatus;
  confirmedVersion: number | null;
  confirmedAt: string | null;
  invitedAt: string | null;
  graceUntil: string | null;
  /** Sections ticked on the REQUIRED version, 0..6. */
  ackedSections: number;
};

const asStatus = (v: unknown): StandardsStatus =>
  v === "confirmed" || v === "employee_unsigned" || v === "not_invited" || v === "grace" || v === "blocked" ? v : "not_required";

/** Every painter at once (staff session or the service client). */
export async function loadStandardsStatuses(supabase: SupabaseClient): Promise<{ rows: StandardsStatusRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc("standards_statuses");
  if (error) {
    reportError(error, { where: "standards.statuses" });
    return { rows: [], error: error.code === "42883" ? "migration 20270225 not applied" : error.message };
  }
  const rows = ((data ?? []) as {
    contractor_id: string; status: string; confirmed_version: number | null; confirmed_at: string | null;
    invited_at: string | null; grace_until: string | null; acked_sections: number | null;
  }[]).map((r) => ({
    contractorId: r.contractor_id, status: asStatus(r.status), confirmedVersion: r.confirmed_version,
    confirmedAt: r.confirmed_at, invitedAt: r.invited_at, graceUntil: r.grace_until, ackedSections: r.acked_sections ?? 0,
  }));
  return { rows, error: null };
}

export type MyStandards = {
  status: StandardsStatus;
  /** The sections ticked on the required version. */
  acked: Set<string>;
  requiredVersionNo: number | null;
  requiredVersionId: string | null;
  changeNote: string;
  confirmedAt: string | null;
  confirmedNo: number | null;
  graceUntil: string | null;
  /** The newest version this painter had confirmed before the required one, if any — the "what changed" case (⚑18). */
  previousConfirmedNo: number | null;
};

/** The signed-in painter's own position. */
export async function loadMyStandards(supabase: SupabaseClient, contractorId: string): Promise<{ my: MyStandards | null; error: string | null }> {
  const [statusRes, versionsRes, acksRes, rowRes] = await Promise.all([
    supabase.rpc("standards_status"),
    supabase.from("standards_versions").select("id, version_no, is_material, change_note, published_at").not("published_at", "is", null).order("version_no", { ascending: false }),
    supabase.from("standards_acks").select("version_id, section_key, acked_at").eq("contractor_id", contractorId),
    supabase.from("contractors").select("standards_grace_until").eq("id", contractorId).maybeSingle(),
  ]);
  for (const [where, res] of [["status", statusRes], ["versions", versionsRes], ["acks", acksRes], ["row", rowRes]] as const) {
    if (res.error) { reportError(res.error, { where: `standards.my.${where}` }); return { my: null, error: res.error.message }; }
  }
  const versions = (versionsRes.data ?? []) as { id: string; version_no: number; is_material: boolean; change_note: string }[];
  const required = versions.find((v) => v.is_material) ?? null;
  const acks = (acksRes.data ?? []) as { version_id: string; section_key: string; acked_at: string }[];
  const acked = new Set(acks.filter((a) => required && a.version_id === required.id).map((a) => a.section_key));
  // Versions with all six ticks, newest first.
  const complete = versions.filter((v) => new Set(acks.filter((a) => a.version_id === v.id).map((a) => a.section_key)).size >= 6);
  const confirmed = complete[0] ?? null;
  const confirmedAt = confirmed ? acks.filter((a) => a.version_id === confirmed.id).map((a) => a.acked_at).sort().at(-1) ?? null : null;
  const previous = required ? complete.find((v) => v.version_no < required.version_no) ?? null : null;
  return {
    my: {
      status: asStatus(statusRes.data),
      acked,
      requiredVersionNo: required?.version_no ?? null,
      requiredVersionId: required?.id ?? null,
      changeNote: required?.change_note ?? "",
      confirmedAt,
      confirmedNo: confirmed?.version_no ?? null,
      graceUntil: (rowRes.data as { standards_grace_until: string | null } | null)?.standards_grace_until ?? null,
      previousConfirmedNo: previous?.version_no ?? null,
    },
    error: null,
  };
}

/** settings.standards_rules through whichever client can read settings (staff or service). */
export async function loadStandardsRules(supabase: SupabaseClient): Promise<StandardsRules> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "standards_rules").maybeSingle();
  if (error) reportError(error, { where: "standards.rules", bestEffort: true });
  return mergeStandardsRules((data as { value?: unknown } | null)?.value);
}
