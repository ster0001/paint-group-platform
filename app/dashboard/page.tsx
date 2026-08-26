import { redirect } from "next/navigation";

// The dev-era customer dashboard is superseded by the customer portal
// (3a-2). Retire the old route the same day its replacement ships — the
// /invoices lesson from the invoicing build.
export default function DashboardPage() {
  redirect("/account");
}
