import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/contractor/session";
import { listContractorJobs, JOB_STATUS_CHIP, shortDate } from "@/lib/contractor/jobs";
import {
  DOC_COLUMNS,
  missingProfileFields,
  daysUntil,
  docState,
  type ContractorDoc,
} from "@/lib/contractor/model";

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
  const { name, contractor } = await requireContractor();

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

  const supabase = await createClient();
  const { data: docsData } = await supabase
    .from("contractor_documents")
    .select(DOC_COLUMNS)
    .eq("contractor_id", contractor.id)
    .order("created_at", { ascending: false });
  const docs = (docsData as ContractorDoc[] | null) ?? [];
  const jobs = await listContractorJobs(contractor.id);

  const insurance = docs.find((d) => d.kind === "insurance" && docState(d) === "valid");
  const insuranceDays = daysUntil(insurance?.expires_on ?? null);
  const missing = missingProfileFields(contractor);

  // Everything the contractor has to act on right now, drawn from real state.
  const actions: { icon: string; text: string; chip?: string }[] = [];
  const awaitingCheck = docs.find((d) => d.kind === "insurance" && d.file_url && !d.verified_at);
  if (!insurance && awaitingCheck) {
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
  if (missing.length) {
    actions.push({
      icon: "🏷",
      text: `Finish your company profile — still missing ${missing.join(", ")}`,
    });
  }

  return (
    <div className="wrap">
      <h1>G&rsquo;day, {firstName(name)}</h1>
      <p className="slab">{melbourneDate()}</p>

      {/* Can this contractor be offered work? The single most important fact. */}
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
    </div>
  );
}
