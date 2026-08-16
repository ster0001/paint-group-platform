import { requireContractor } from "@/lib/contractor/session";
import Placeholder from "../Placeholder";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  await requireContractor();
  return (
    <Placeholder
      title="Pending requests"
      slab="Respond within the countdown — offers expire"
      icon="◔"
      heading="No offers yet"
      body="When Paint Group offers you a job it appears here with the dates, hours allowance, your price and a 24-hour clock to accept, propose a new date, or decline. Until you accept, you'll only see the suburb — never the customer's full address."
      soon="Arrives with scheduling"
    />
  );
}
