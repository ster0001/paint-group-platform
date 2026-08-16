import { createClient } from "@/lib/supabase/server";
import { DOC_COLUMNS, type ContractorDoc } from "./model";

/**
 * Load a contractor's compliance documents.
 *
 * Returns the error rather than swallowing it. This has now bitten three times:
 * a query fails (usually because the code deployed before its migration ran),
 * the caller does `?? []`, and the screen confidently reports the opposite of
 * the truth — "no contractors", or "upload your insurance" to someone who
 * uploaded it weeks ago. An empty list and a broken query must not look the
 * same to the person reading the page.
 */
export async function loadContractorDocs(
  contractorId: string,
): Promise<{ docs: ContractorDoc[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contractor_documents")
    .select(DOC_COLUMNS)
    .eq("contractor_id", contractorId)
    .order("created_at", { ascending: false });

  return {
    docs: (data as ContractorDoc[] | null) ?? [],
    error: error ? error.message : null,
  };
}

/** Shown when the query above fails, in words the reader can act on. */
export function docsErrorMessage(error: string): string {
  if (/column .* does not exist/i.test(error)) {
    return "Your documents can't be loaded — Paint Group needs to run the latest database migration. Nothing you've uploaded has been lost.";
  }
  return `Your documents can't be loaded right now (${error}).`;
}
