import { redirect } from "next/navigation";

/** Payments lived here from Step 2 to Step 8c; since the switch-over it is /invoicing (query kept). */
export default async function PaymentsMoved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  const s = q.toString();
  redirect(s ? `/invoicing?${s}` : "/invoicing");
}
