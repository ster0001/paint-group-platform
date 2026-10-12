import { redirect } from "next/navigation";

/**
 * The "contractor invoice in" staff email linked here before 12 Oct 2026, but
 * only `ci/[id]/pdf` ever existed, so every one of those links 404'd. The
 * approval lives on the Payables tab; already-sent emails land there too.
 */
export default function ContractorInvoiceLink() {
  redirect("/invoicing?tab=pay");
}
