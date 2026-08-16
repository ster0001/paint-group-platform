import { requireContractor } from "@/lib/contractor/session";
import Placeholder from "../Placeholder";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  await requireContractor();
  return (
    <Placeholder
      title="Calendar"
      slab="Your booked work and your days off"
      icon="▦"
      heading="Nothing scheduled"
      body="Your booked jobs show here once offers go live. You'll also be able to block out days you're unavailable — those go straight onto Paint Group's scheduling board, so you never get offered work on a day you can't take."
      soon="Arrives with scheduling"
    />
  );
}
