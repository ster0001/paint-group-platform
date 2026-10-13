import { redirect } from "next/navigation";

/**
 * The old per-job invoice list (24 Aug). Retired at the Payments switch-over
 * (Step 8d, ⚑P16: Step 0 found nothing unique on it): All jobs on /invoicing is
 * the same list, and a search carries over.
 */
export default async function InvoicesMoved({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  redirect(q ? `/invoicing?view=table&q=${encodeURIComponent(q.slice(0, 120))}` : "/invoicing?view=table");
}
