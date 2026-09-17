import Link from "next/link";
import { requireContractor } from "@/lib/contractor/session";
import { listContractorOffers } from "@/lib/contractor/offers";
import { effectiveState, isLive } from "@/lib/scheduling/offers";
import OfferCard from "./requests/OfferCard";
import { listContractorJobs, JOB_STATUS_CHIP, shortDate } from "@/lib/contractor/jobs";
import { listEmployeeJobs } from "@/lib/contractor/employeeJobs";
import { missingProfileFields, daysUntil, docState, workcoverNeeded, employeeDocReminders } from "@/lib/contractor/model";
import { loadContractorDocs, docsErrorMessage } from "@/lib/contractor/docs";
import { createClient } from "@/lib/supabase/server";
import { loadMyTimesheet } from "@/lib/contractor/timesheets";
import TimesheetCard from "./TimesheetCard";

export const dynamic = "force-dynamic";

const melbourneDate = () =>
  new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Australia/Melbourne",
  }).format(new Date());

const firstName = (full: string) => full.trim().split(/\s+/)[0] || "there";

export default async function PortalHome() {
  const { name, contractor, capabilities } = await requireContractor();

  // Staff haven't finished setting this account up.
  if (!contractor) {
    return (
      <div className="wrap">
        <h1>G&rsquo;day, {firstName(name)}</h1>
        <p className="slab">{melbourneDate()}</p>
        <div className="empty">
          <i aria-hidden>⏳</i>
          <b>Your account isn&rsquo;t set up yet</b>
          Paint Group still has to add you to the contractor list. Once they do, your
          profile, offers and invoicing all appear here.
        </div>
      </div>
    );
  }

  const { docs, error: docsError } = await loadContractorDocs(contractor.id);
  const jobs = capabilities.acceptsOffers ? await listContractorJobs(contractor.id) : await listEmployeeJobs();
  // Session 6: the employee's day — Start / Finish, hours only. Nothing for a
  // contractor, whose days are the offer they accepted.
  const timesheet = capabilities.clocksOn ? await loadMyTimesheet() : null;
  // Live offers land on the FRONT page with their countdown (Tom, 25 Aug) —
  // a 24-hour clock shouldn't hide behind the Requests tab. An employee is
  // never offered (ruling 1); their new assignments show as "Tap Accept" jobs.
  const liveOffers = capabilities.acceptsOffers
    ? (await listContractorOffers(contractor.id)).filter((o) => isLive(effectiveState(o.offer)))
    : [];

  // Front-page work items (Tom, 1 Sep #2): variations waiting on the painter's
  // approval, and failed quality checks with areas still to put right. Both
  // batched across the job list (the withSurfaceProgress shape) — RLS scopes
  // every row to their own jobs.
  const jobTitle = new Map(jobs.map((j) => [j.id, j.doc?.jobTitle || j.woRef]));
  const jobIds = jobs.map((j) => j.id);
  let waitingVariations: { id: string; workOrderId: string; comment: string; credit: boolean }[] = [];
  const rectifyByJob = new Map<string, number>();
  if (jobIds.length > 0) {
    const db = await createClient();
    const [{ data: vRows }, { data: rectRows }] = await Promise.all([
      db.from("wo_variations")
        .select("id, work_order_id, comment, credit, released_at, needs_manual_deduction, deduction_cents")
        .eq("status", "customer_approved")
        .in("work_order_id", jobIds),
      db.from("wo_surfaces")
        .select("id, work_order_id")
        .eq("rectification", true)
        .neq("state", "done")
        .in("work_order_id", jobIds),
    ]);
    waitingVariations = ((vRows ?? []) as {
      id: string; work_order_id: string; comment: string; credit: boolean;
      released_at: string | null; needs_manual_deduction: boolean; deduction_cents: number | null;
    }[])
      // Mirrors the job page's own rule: additions need the release; a credit
      // waits only when the office still owes the manual deduction figure.
      .filter((v) => (v.credit
        ? !(v.needs_manual_deduction && v.deduction_cents == null)
        : v.released_at !== null))
      .map((v) => ({ id: v.id, workOrderId: v.work_order_id, comment: v.comment, credit: v.credit }));
    for (const r of (rectRows ?? []) as { work_order_id: string }[]) {
      rectifyByJob.set(r.work_order_id, (rectifyByJob.get(r.work_order_id) ?? 0) + 1);
    }
  }

  const insurance = docs.find((d) => d.kind === "insurance" && docState(d) === "valid");
  const insuranceDays = daysUntil(insurance?.expires_on ?? null);
  const missing = missingProfileFields(contractor);

  // Everything the contractor has to act on right now, drawn from real state.
  const actions: { icon: string; text: string; chip?: string }[] = [];
  const awaitingCheck = docs.find((d) => d.kind === "insurance" && d.file_url && !d.verified_at);
  if (docsError) {
    // Say nothing about insurance when we couldn't read the documents at all —
    // telling someone to upload what they already uploaded is worse than silence.
  } else if (!capabilities.requiresInsurance) {
    // An employee's tickets (ruling 5): white card and working at heights,
    // reminded about, never a gate on anything.
    for (const r of employeeDocReminders(docs)) actions.push({ icon: "🪪", text: r.text, chip: r.chip });
  } else if (!insurance && awaitingCheck) {
    actions.push({
      icon: "🛡",
      text: "Paint Group are checking your insurance certificate — nothing more for you to do",
      chip: "With them",
    });
  } else if (!insurance) {
    actions.push({
      icon: "🛡",
      text: "Upload your public liability certificate — you can't be offered work without it",
      chip: "Required",
    });
  } else if (insuranceDays !== null && insuranceDays <= 45) {
    actions.push({
      icon: "🛡",
      text: `Public liability expires in ${insuranceDays} day${insuranceDays === 1 ? "" : "s"} — upload the renewal`,
      chip: `${insuranceDays}d`,
    });
  }
  // WorkCover (Tom, 17 Sep): asked for, never a gate — the offerable card
  // above stays green on public liability alone. A contractor's paperwork:
  // an employee is covered by Paint Group's own policy (ruling 5).
  // Tom (17 Sep): a crew above one with no WorkCover on file is REMINDED on
  // the Ready-for-work card itself, not only in the action list. Never a
  // gate — the card stays green on public liability.
  const workcoverReminder = !docsError && capabilities.requiresInsurance && workcoverNeeded(contractor.crew_size, docs);
  if (workcoverReminder) {
    actions.push({
      icon: "🛡",
      text: "Upload your WorkCover certificate — required while anyone works with you",
      chip: "Needed",
    });
  }
  // Company details exist for the RCTI — an employee has no invoice to put them on.
  if (missing.length && capabilities.canSelfInvoice) {
    actions.push({
      icon: "🏷",
      text: `Finish your company profile — still missing ${missing.join(", ")}`,
    });
  }

  return (
    <div className="wrap">
      <h1>G&rsquo;day, {firstName(name)}</h1>
      <p className="slab">{melbourneDate()}</p>

      {docsError && <div className="err">{docsErrorMessage(docsError)}</div>}

      {/* Can this contractor be offered work? The single most important fact —
          for a contractor. An employee is assigned, never offered (ruling 1). */}
      {capabilities.acceptsOffers && (
      <div className={`card ${contractor.offerable ? "greenish" : "amberish"}`}>
        <span className={`chip ${contractor.offerable ? "grn" : "amb"}`}>
          {contractor.offerable ? "Ready for work" : "Not yet offerable"}
        </span>
        <div style={{ marginTop: 10, fontWeight: 600, fontSize: "14.5px" }}>
          {contractor.offerable
            ? "You're compliant — Paint Group can offer you jobs"
            : awaitingCheck
              ? "Waiting on Paint Group"
              : "Compliance incomplete"}
        </div>
        {contractor.offerable && workcoverReminder && (
          <div style={{ fontSize: "12.5px", color: "var(--amber, #E0A83C)", fontWeight: 600, marginTop: 6 }}
            data-testid="ready-workcover-reminder">
            REQUIRED: Please upload your WorkCover certificate —{" "}
            <Link href="/portal/profile" style={{ color: "inherit" }}>Insurance &amp; licences</Link>
          </div>
        )}
        <div style={{ fontSize: "12.5px", color: "var(--muted)", marginTop: 4 }}>
          {contractor.offerable
            ? "Offers will land in Requests with a 24-hour clock to respond."
            : awaitingCheck
              ? "Your certificate is uploaded and Paint Group are checking it. You'll be available for work as soon as they confirm."
              : "Paint Group can't send you an offer until a current public liability certificate is on file."}
        </div>
        {!contractor.offerable && (
          <Link href="/portal/profile" className="btn cy">
            Complete my profile
          </Link>
        )}
      </div>
      )}

      {timesheet && (
        <TimesheetCard open={timesheet.open} recent={timesheet.recent} error={timesheet.error}
          today={new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}
          jobs={jobs.filter((j) => j.status !== "complete" && j.status !== "cancelled").map((j) => ({ id: j.id, title: j.doc?.jobTitle || j.woRef }))} />
      )}

      {actions.length > 0 && (
        <div className="card">
          <h3>Action items</h3>
          {actions.map((a, i) => (
            <Link key={i} href="/portal/profile" className="act">
              <i aria-hidden>{a.icon}</i>
              <span>{a.text}</span>
              {a.chip && (
                <span className="push">
                  <span className="chip amb">{a.chip}</span>
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Variations the customer has approved, waiting on the painter. */}
      {waitingVariations.length > 0 && (
        <div className="card amberish" data-testid="home-variations">
          <h3>Variations waiting on you</h3>
          {waitingVariations.map((v) => (
            <Link key={v.id} href={`/portal/jobs/${v.workOrderId}`} className="act">
              <i aria-hidden>±</i>
              <span>
                {jobTitle.get(v.workOrderId) ?? "Your job"}
                <br />
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>{v.comment || "A change to the scope"}</span>
              </span>
              <span className="push">
                <span className="chip amb">{v.credit ? "Acknowledge" : "Approve"}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Failed quality checks — areas still to put right. */}
      {rectifyByJob.size > 0 && (
        <div className="card amberish" data-testid="home-qa-fails">
          <h3>Quality check — put right</h3>
          {[...rectifyByJob.entries()].map(([woId, count]) => (
            <Link key={woId} href={`/portal/jobs/${woId}`} className="act">
              <i aria-hidden>✕</i>
              <span>
                {jobTitle.get(woId) ?? "Your job"}
                <br />
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                  {count} area{count === 1 ? "" : "s"} missed — the details and photos are on the job
                </span>
              </span>
              <span className="push">
                <span className="chip cly">Rectify</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {liveOffers.length > 0 && (
        <div style={{ marginTop: 14 }} data-testid="home-offers">
          <h3 style={{ margin: "0 0 8px" }}>Needs your answer</h3>
          {liveOffers.map((o) => (
            <OfferCard key={o.offer.id} offer={o.offer} woRef={o.woRef} doc={o.doc}
              workOrderId={o.offer.work_order_id} myBlocks={[]} myJobDays={[]} />
          ))}
        </div>
      )}

      {/* Real jobs once any have been issued; otherwise say so plainly. */}
      <div className="card">
        <h3>Your work</h3>
        {jobs.length === 0 ? (
          <div style={{ fontSize: "12.5px", color: "var(--muted)", marginTop: 6 }}>
            Nothing booked. Jobs appear here as soon as Paint Group issues one to you.
          </div>
        ) : (
          <>
            {jobs.slice(0, 3).map((j) => {
              const chip = JOB_STATUS_CHIP[j.status] ?? { cls: "gry", label: j.status };
              return (
                <Link key={j.id} href={`/portal/jobs/${j.id}`} className="act">
                  <i aria-hidden>▤</i>
                  <span>
                    {j.doc?.jobTitle || j.woRef}
                    <br />
                    <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".06em" }}>
                      {shortDate(j.startDate)}
                      {j.doc?.finishCode ? ` · ${j.doc.finishCode}` : ""}
                    </span>
                  </span>
                  <span className="push">
                    <span className={`chip ${chip.cls}`}>{chip.label}</span>
                  </span>
                </Link>
              );
            })}
            <Link href="/portal/jobs" className="btn gh">
              All jobs
            </Link>
          </>
        )}
      </div>

      {/* Company, ABN, GST, insurance: the RCTI entity. Nothing an employee has (§3.7). */}
      {capabilities.canSelfInvoice && (
      <div className="card">
        <h3>Your details</h3>
        <div className="frow">
          <span className="l">Company</span>
          <span className={`v ${contractor.company_name?.trim() ? "" : "empty"}`}>
            {contractor.company_name?.trim()?.toUpperCase() || "NOT SET"}
          </span>
        </div>
        <div className="frow">
          <span className="l">ABN</span>
          <span className={`v ${contractor.abn?.trim() ? "" : "empty"}`}>
            {contractor.abn?.trim() || "NOT SET"}
          </span>
        </div>
        <div className="frow">
          <span className="l">GST</span>
          <span className="v">{contractor.gst_registered ? "REGISTERED" : "NOT REGISTERED"}</span>
        </div>
        <div className="frow">
          <span className="l">Insurance</span>
          <span className={`v ${insurance ? "green" : "amber"}`}>
            {insurance
              ? insurance.expires_on
                ? `VALID TO ${insurance.expires_on}`
                : "VALID"
              : "NOT ON FILE"}
          </span>
        </div>
        <Link href="/portal/profile" className="btn gh">
          Open my profile
        </Link>
      </div>
      )}
    </div>
  );
}
