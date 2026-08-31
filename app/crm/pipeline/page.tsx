import { redirect } from "next/navigation";

/** The board is a view mode inside Customers now (shell brief §2.1), not a
 *  destination. Old links keep working; they just arrive at the one place. */
export default function PipelineRedirect() {
  redirect("/crm/customers?view=board");
}
