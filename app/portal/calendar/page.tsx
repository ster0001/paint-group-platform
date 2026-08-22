import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/contractor/session";
import { listContractorJobs } from "@/lib/contractor/jobs";
import CalendarGrid, { type PortalBlock, type PortalJobDay } from "./CalendarGrid";
import Placeholder from "../Placeholder";
import { jobDaysFor } from "@/lib/contractor/jobDays";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const { contractor } = await requireContractor();

  if (!contractor) {
    return (
      <Placeholder
        title="Calendar"
        slab="Your booked work and your days off"
        icon="▦"
        heading="Your account isn't set up yet"
        body="Once Paint Group adds you to the contractor list, your booked work and your days off live here."
        soon="Waiting on setup"
      />
    );
  }

  const supabase = await createClient();
  const { data: unavail } = await supabase
    .from("contractor_unavailability")
    .select("id, start_date, end_date, reason, source")
    .eq("contractor_id", contractor.id);

  const blocks: PortalBlock[] = (
    (unavail as { id: string; start_date: string; end_date: string; reason: string; source: "contractor" | "staff" }[] | null) ?? []
  ).map((u) => ({ id: u.id, start: u.start_date, end: u.end_date, reason: u.reason, source: u.source }));

  // Booked days come from the jobs themselves, so the calendar and the Jobs tab
  // can never disagree.
  const jobs = await listContractorJobs(contractor.id);
  const jobDays: PortalJobDay[] = jobDaysFor(jobs);

  return (
    <div className="wrap">
      <h1>Calendar</h1>
      <p className="slab">Tap a free day to block it out — Paint Group sees it straight away</p>
      <div className="card">
        <CalendarGrid blocks={blocks} jobDays={jobDays} />
      </div>
      <p className="hint" style={{ padding: "0 2px" }}>
        Days you block out become unbookable on Paint Group&rsquo;s scheduling board
        immediately. Booked days can&rsquo;t be blocked here — give the office a call
        if something&rsquo;s changed.
      </p>
    </div>
  );
}
