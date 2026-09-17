import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/contractor/session";
import { listContractorJobs } from "@/lib/contractor/jobs";
import { listEmployeeJobs } from "@/lib/contractor/employeeJobs";
import CalendarGrid, { type PortalBlock, type PortalJobDay } from "./CalendarGrid";
import Placeholder from "../Placeholder";
import { jobDaysFor } from "@/lib/contractor/jobDays";
import { gcalStatus } from "@/lib/gcal/sync";
import GoogleSyncCard from "./GoogleSyncCard";
import TimeOffCard, { type TimeOffRow } from "./TimeOffCard";
import { reportError } from "@/lib/monitoring/report";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ gcal?: string }>;
}) {
  const { contractor, capabilities } = await requireContractor();

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
  // S7: kind / approval columns ride along (20270154 + 20270164). A declined
  // request is not a day off — it stays in the list, not on the grid.
  const { data: unavail, error: unavailError } = await supabase
    .from("contractor_unavailability")
    .select("id, start_date, end_date, reason, source, kind, approved_at, declined_at, decline_reason")
    .eq("contractor_id", contractor.id);
  if (unavailError) reportError(unavailError, { where: "portal.calendar.unavailability" });
  type URow = {
    id: string; start_date: string; end_date: string; reason: string; source: "contractor" | "staff";
    kind: TimeOffRow["kind"] | null; approved_at: string | null; declined_at: string | null; decline_reason: string | null;
  };
  const timeOff: TimeOffRow[] = ((unavail as URow[] | null) ?? []).map((u) => ({
    id: u.id, kind: u.kind ?? "other", start: u.start_date, end: u.end_date, reason: u.reason, source: u.source,
    approvedAt: u.approved_at, declinedAt: u.declined_at, declineReason: u.decline_reason ?? "",
  }));
  const blocks: PortalBlock[] = timeOff
    .filter((u) => !u.declinedAt)
    .map((u) => ({
      id: u.id, start: u.start, end: u.end, source: u.source,
      reason: u.kind === "leave" || u.kind === "rdo"
        ? `${u.kind === "rdo" ? "RDO" : "Leave"}${u.approvedAt ? "" : " (requested)"}`
        : u.kind === "sick" ? "Sick" : u.reason,
    }));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  // Booked days come from the jobs themselves, so the calendar and the Jobs tab
  // can never disagree.
  // An employee's booked days are their ASSIGNED days (their own span on each
  // job), through the money-free RPC; a contractor's are their bookings.
  const jobs = capabilities.acceptsOffers ? await listContractorJobs(contractor.id) : await listEmployeeJobs();
  const jobDays: PortalJobDay[] = jobDaysFor(jobs);

  // §4b: booked walkthroughs on the calendar, tap-through to the job. They
  // ride as jobDays — a walkthrough IS a site visit — labelled so the painter
  // knows it's the sign-off, not a painting day.
  const { data: wt } = await supabase
    .from("wo_walkthroughs")
    .select("work_order_id, kind, scheduled_date")
    .eq("status", "booked");
  for (const w of ((wt ?? []) as { work_order_id: string; kind: string; scheduled_date: string }[])) {
    jobDays.push({
      date: w.scheduled_date,
      label: w.kind === "final" ? "Walkthrough" : "Pre-walk",
      status: "walkthrough",
      id: w.work_order_id,
    });
  }

  return (
    <div className="wrap">
      <h1>Calendar</h1>
      <p className="slab">
        {capabilities.acceptsOffers
          ? "Tap a free day to block it out — Paint Group sees it straight away"
          : "Your assigned days, and your time off"}
      </p>
      <div className="card">
        <CalendarGrid blocks={blocks} jobDays={jobDays} mode={capabilities.acceptsOffers ? "block" : "view"} />
      </div>
      {capabilities.acceptsOffers ? (
        <p className="hint" style={{ padding: "0 2px" }}>
          Days you block out become unbookable on Paint Group&rsquo;s scheduling board
          immediately. Booked days can&rsquo;t be blocked here — give the office a call
          if something&rsquo;s changed.
        </p>
      ) : (
        // An employee's days off are requested, never blocked (S7, ruling 11).
        <TimeOffCard rows={timeOff} today={today} />
      )}
      {/* Google Calendar reconciles bookings only today — an employee's
          assignments are not pushed yet (employed-painters ledger), so the
          card would promise something it cannot do. */}
      {capabilities.acceptsOffers && (
        <GoogleSyncCard status={await gcalStatus(contractor.id)} flash={(await searchParams).gcal} />
      )}
    </div>
  );
}
