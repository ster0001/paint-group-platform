import { redirect } from "next/navigation";

/**
 * /crm is Today (shell brief §1): on a normal morning, only Today should need
 * opening. The old ?id= deep links from before the four-tab shell land on the
 * same record they always did, at its one true route.
 */
export default async function CrmIndex({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  redirect(id ? `/crm/customers/${id}` : "/crm/today");
}
