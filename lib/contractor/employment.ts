import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmploymentType, type EmploymentType } from "@/lib/painters/capabilities";

/**
 * The painter's employment type (migration 20270153). SERVER ONLY.
 *
 * A separate best-effort select, the works_saturday / phone rule
 * (lib/contractor/weekend.ts): folding the column into CONTRACTOR_COLUMNS
 * would 42703 every portal page until the migration runs. A missing column,
 * a failed read or an unexpected value all degrade to CONTRACTOR — the type
 * every painter was before this brief, whose screens are the proven ones.
 *
 * Degrading to contractor is safe in the direction that matters: a real
 * employee row is only ever mis-read as a contractor when the column does
 * not exist, and a column that does not exist has no employee rows.
 */
export async function employmentTypeFor(db: SupabaseClient, contractorId: string): Promise<EmploymentType> {
  const { data, error } = await db
    .from("contractors").select("id, employment_type").eq("id", contractorId).maybeSingle();
  if (error) return "contractor";
  const value = (data as { employment_type?: unknown } | null)?.employment_type;
  return isEmploymentType(value) ? value : "contractor";
}
