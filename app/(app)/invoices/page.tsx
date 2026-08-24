import { redirect } from "next/navigation";

/**
 * The original S1 read-only invoice list lived here; the real invoicing
 * dashboard (§7.2, 1:1 with design/reference/invoicing-dashboard-mockup.html)
 * is /invoicing. One surface, not two — old links and the sidebar land there.
 */
export default function InvoicesRedirect() {
  redirect("/invoicing");
}
