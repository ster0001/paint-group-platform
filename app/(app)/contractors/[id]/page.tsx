import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { inSlices } from "@/lib/supabase/inSlices";
import { reportError } from "@/lib/monitoring/report";
import { CONTRACTOR_COLUMNS, DOC_COLUMNS, DOC_LABEL, daysUntil, docState, type ContractorDoc, type ContractorRow } from "@/lib/contractor/model";
import { formatDMY } from "@/lib/scheduling/offers";
import { isEmploymentType } from "@/lib/painters/capabilities";
import DeleteContractor from "./DeleteContractor";

export const dynamic = "force-dynamic";

const money = (c: number | null | undefined) =>
  c == null ? "—" : "$" + (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });

/** One labelled row in the details card. Defined here, not inside the page:
 *  a component created during render is a new type every pass. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 py-1.5 last:border-0">
      <span className="text-xs uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  );
}

/** One painter, everything about them (Tom, 18 Sep 2026): who they are, their
 *  paperwork, every job they have done for us, and their quality-check record.
 *  Staff-only — the (app) layout redirects anyone who isn't staff. */
export default async function ContractorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const { data: row, error: rowError } = await supabase
    .from("contractors")
    .select(`${CONTRACTOR_COLUMNS}, requires_qa, rcti_agreement_signed_at, employment_type, phone, works_saturday, works_sunday, profiles ( name )`)
    .eq("id", id)
    .maybeSingle();
  if (rowError) reportError(rowError, { where: "contractorDetail.row" });
  if (!row) notFound();

  const c = row as unknown as ContractorRow & {
    requires_qa: boolean | null; rcti_agreement_signed_at: string | null;
    employment_type?: unknown; phone?: string | null;
    works_saturday?: boolean | null; works_sunday?: boolean | null;
    profiles: { name: string | null } | null;
  };
  const name = c.profiles?.name?.trim() || c.company_name?.trim() || "Painter";
  const employmentType = isEmploymentType(c.employment_type) ? c.employment_type : "contractor";
  const failures: string[] = [];

  // Their jobs. A contractor holds the work order; an employed painter is on it
  // by assignment, so both paths are read and merged.
  const [docsRes, jobsRes, assignRes, invoicesRes, offersRes] = await Promise.all([
    supabase.from("contractor_documents").select(DOC_COLUMNS).eq("contractor_id", id),
    supabase.from("work_orders")
      .select("id, wo_ref, stage, status, start_date, end_date, contractor_payment_cents, wo_snapshot, created_at")
      .eq("contractor_id", id).order("created_at", { ascending: false }).limit(200),
    supabase.from("wo_assignments")
      .select("work_order_id, start_date, end_date, is_lead, status, work_orders(id, wo_ref, stage, status, start_date, end_date, wo_snapshot, created_at)")
      .eq("contractor_id", id).order("start_date", { ascending: false }).limit(200),
    supabase.from("contractor_invoices")
      .select("id, number, status, total_inc_cents, created_at").eq("contractor_id", id)
      .order("created_at", { ascending: false }).limit(50),
    supabase.from("booking_offers").select("id, state").eq("contractor_id", id),
  ]);
  for (const [label, r] of [["documents", docsRes], ["jobs", jobsRes], ["assignments", assignRes], ["invoices", invoicesRes], ["offers", offersRes]] as const) {
    if (r.error) { reportError(r.error, { where: `contractorDetail.${label}` }); failures.push(label); }
  }

  type WoRow = {
    id: string; wo_ref: string; stage: string; status: string; start_date: string | null; end_date: string | null;
    contractor_payment_cents?: number | null; wo_snapshot: { jobTitle?: string; jobAddress?: string } | null; created_at: string;
  };
  type AssignRow = { work_order_id: string; start_date: string; end_date: string; is_lead: boolean; status: string; work_orders: WoRow | null };

  const owned = (jobsRes.error ? [] : (jobsRes.data ?? [])) as unknown as WoRow[];
  const assigned = (assignRes.error ? [] : (assignRes.data ?? [])) as unknown as AssignRow[];
  const jobById = new Map<string, WoRow & { isLead?: boolean }>();
  for (const w of owned) jobById.set(w.id, { ...w, isLead: true });
  for (const a of assigned) {
    if (!a.work_orders) continue;
    const existing = jobById.get(a.work_order_id);
    jobById.set(a.work_order_id, { ...(existing ?? a.work_orders), isLead: existing?.isLead || a.is_lead });
  }
  const jobs = [...jobById.values()].sort((x, y) => y.created_at.localeCompare(x.created_at));
  const completed = jobs.filter((j) => j.stage === "closed" || j.status === "complete");

  // The quality-check record, for the jobs above.
  const { rows: qaRows, error: qaError } = await inSlices(jobs.map((j) => j.id), (slice) =>
    supabase.from("wo_qa_checks").select("id, work_order_id, kind, result, notes, checked_at, scheduled_for, created_at").in("work_order_id", slice));
  if (qaError) { reportError(qaError, { where: "contractorDetail.qa" }); failures.push("quality checks"); }
  type QaRow = { id: string; work_order_id: string; kind: string; result: string | null; notes: string; checked_at: string | null; scheduled_for: string | null; created_at: string };
  // Newest first. created_at is the last resort so a check recorded without a
  // checked_at stamp still orders sensibly instead of sinking to the bottom.
  const when = (q: QaRow) => q.checked_at ?? q.scheduled_for ?? q.created_at;
  const qa = (qaRows as QaRow[]).sort((a, b) => when(b).localeCompare(when(a)));
  const passed = qa.filter((q) => q.result === "pass").length;
  const failed = qa.filter((q) => q.result === "fail").length;

  // Their login address lives on auth, not on the contractors row (the
  // sendInvoice rule) — read it with the service client, best effort.
  let email: string | null = null;
  const service = createServiceClient();
  if (service && c.profile_id) {
    const { data: u, error: uError } = await service.auth.admin.getUserById(c.profile_id);
    if (uError) reportError(uError, { where: "contractorDetail.email", bestEffort: true });
    else email = u.user?.email ?? null;
  }

  const docs = ((docsRes.error ? [] : docsRes.data ?? []) as ContractorDoc[]);
  const offers = (offersRes.error ? [] : offersRes.data ?? []) as { state: string }[];
  const invoices = (invoicesRes.error ? [] : invoicesRes.data ?? []) as { id: string; number: string | null; status: string; total_inc_cents: number; created_at: string }[];

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Link href="/contractors" className="text-xs uppercase tracking-wide text-gray-500 hover:text-gray-800">← Contractors</Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3 rounded-xl bg-ink px-5 py-4 text-white">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="painter-name">{name}</h1>
          <p className="text-sm text-gray-400">
            {c.company_name?.trim() || "No company name"}
            {employmentType === "employee" ? " · Employed painter" : " · Contractor"}
            {c.active ? "" : " · SUSPENDED"}
          </p>
        </div>
        <span className={`rounded-md border px-3 py-2 text-xs font-medium ${c.offerable ? "border-emerald-400 text-emerald-200" : "border-gray-600 text-gray-300"}`}>
          {employmentType === "employee" ? "Assigned, never offered" : c.offerable ? "Ready for work" : "Not offerable"}
        </span>
      </div>

      {failures.length > 0 && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="detail-read-failure">
          Couldn&rsquo;t read {failures.join(", ")} — what&rsquo;s shown may be incomplete. It has been reported.
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-4" data-testid="card-who">
          <h2 className="text-sm font-semibold">Their details</h2>
          <div className="mt-2">
            <Field label="Mobile" value={c.phone?.trim()
              ? <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className="text-sky-700 hover:underline">{c.phone}</a>
              : <span className="text-gray-400">not given</span>} />
            <Field label="Email" value={email
              ? <a href={`mailto:${email}`} className="text-sky-700 hover:underline">{email}</a>
              : <span className="text-gray-400">unknown</span>} />
            <Field label="Painters on their crew" value={<span data-testid="crew-size">{c.crew_size}</span>} />
            <Field label="Tier" value={c.tier || "—"} />
            <Field label="ABN" value={c.abn?.trim() || <span className="text-gray-400">not given</span>} />
            <Field label="GST" value={c.gst_registered ? "Registered" : "Not registered"} />
            <Field label="Address" value={c.address?.trim() || <span className="text-gray-400">not given</span>} />
            <Field label="Weekends" value={`Sat ${c.works_saturday ? "yes" : "no"} · Sun ${c.works_sunday ? "yes" : "no"}`} />
            <Field label="Bank" value={c.bank_account_last4 ? `${c.bank_bsb ?? "—"} · ···· ${c.bank_account_last4}` : <span className="text-gray-400">not on file</span>} />
            <Field label="RCTI agreement" value={c.rcti_agreement_signed_at ? `signed ${formatDMY(c.rcti_agreement_signed_at.slice(0, 10))}` : "not signed"} />
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4" data-testid="card-docs">
          <h2 className="text-sm font-semibold">Paperwork</h2>
          {docs.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">Nothing uploaded.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {docs.map((d) => {
                const state = docState(d);
                const days = daysUntil(d.expires_on);
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 text-sm" data-testid={`doc-${d.id}`}>
                    <span>
                      {DOC_LABEL[d.kind]}
                      <span className="block text-xs text-gray-500">
                        {d.expires_on ? `expires ${formatDMY(d.expires_on)}` : "no expiry"}
                        {d.verified_at ? " · checked" : " · not checked yet"}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${
                      state === "valid" ? (days !== null && days <= 45 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")
                        : state === "expired" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-600"}`}>
                      {state === "valid" ? (days !== null && days <= 45 ? `${days}d left` : "Valid") : state === "expired" ? "Expired" : "Pending"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4" data-testid="card-qa">
        <h2 className="text-sm font-semibold">
          Quality checks
          <span className="ml-2 text-xs font-normal text-gray-500" data-testid="qa-tally">
            {qa.length === 0 ? "none on record" : `${passed} passed · ${failed} failed · ${qa.length} total`}
          </span>
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          {c.requires_qa ? "Every job of theirs is quality checked." : "Checked on their first jobs, then as scheduled."}
        </p>
        {qa.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No quality check has been recorded against their jobs yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {qa.slice(0, 25).map((q) => {
              const job = jobById.get(q.work_order_id);
              return (
                <li key={q.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm" data-testid={`qa-${q.id}`}>
                  <span>
                    <Link href={`/pc/wo/${q.work_order_id}`} className="font-medium text-sky-700 hover:underline">
                      {job?.wo_snapshot?.jobTitle || job?.wo_ref || "A job"}
                    </Link>
                    <span className="block text-xs text-gray-500">
                      {q.kind.replace(/_/g, " ")}
                      {q.checked_at ? ` · ${formatDMY(q.checked_at.slice(0, 10))}` : q.scheduled_for ? ` · due ${formatDMY(q.scheduled_for)}` : ""}
                      {q.notes ? ` · ${q.notes}` : ""}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${
                    q.result === "pass" ? "bg-emerald-100 text-emerald-800" : q.result === "fail" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-600"}`}>
                    {q.result === "pass" ? "Passed" : q.result === "fail" ? "Failed" : "Not checked"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4" data-testid="card-jobs">
        <h2 className="text-sm font-semibold">
          Jobs
          <span className="ml-2 text-xs font-normal text-gray-500" data-testid="jobs-tally">
            {completed.length} completed · {jobs.length} in total · {offers.filter((o) => ["offered", "proposed"].includes(o.state)).length} awaiting an answer
          </span>
        </h2>
        {jobs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">They have never been on a job.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {jobs.slice(0, 50).map((j) => (
              <li key={j.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm" data-testid={`job-${j.id}`}>
                <span>
                  <Link href={`/pc/wo/${j.id}`} className="font-medium text-sky-700 hover:underline">
                    {j.wo_snapshot?.jobTitle || j.wo_snapshot?.jobAddress || j.wo_ref}
                  </Link>
                  <span className="block text-xs text-gray-500">
                    {j.wo_ref}
                    {j.start_date ? ` · ${formatDMY(j.start_date)}` : ""}
                    {j.end_date && j.end_date !== j.start_date ? ` → ${formatDMY(j.end_date)}` : ""}
                    {employmentType === "employee" && j.isLead ? " · lead painter" : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {employmentType === "contractor" && <span className="text-xs text-gray-500">{money(j.contractor_payment_cents)}</span>}
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    j.stage === "closed" ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}`}>
                    {j.stage === "closed" ? "Completed" : j.stage.replace(/_/g, " ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {employmentType === "contractor" && invoices.length > 0 && (
        <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4" data-testid="card-invoices">
          <h2 className="text-sm font-semibold">Their invoices</h2>
          <ul className="mt-3 divide-y divide-gray-100">
            {invoices.map((i) => (
              <li key={i.id} className="flex items-baseline justify-between gap-2 py-2 text-sm">
                <span>{i.number ?? "Draft"}<span className="block text-xs text-gray-500">{formatDMY(i.created_at.slice(0, 10))} · {i.status}</span></span>
                <span className="font-medium">{money(i.total_inc_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6">
        <DeleteContractor id={c.id} name={name} suspended={!c.active} />
      </div>
    </main>
  );
}
