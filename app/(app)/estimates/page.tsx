import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NewEstimateButton, { type TemplateMeta } from "./NewEstimateButton";
import EstimatesTable, { type EstimateRow } from "./EstimatesTable";
import AssistantFab from "@/app/quote/AssistantFab";
import { LIST_FILTERS as FILTERS, filterQuery } from "@/lib/estimate/displayStatus";
import WizardSessionsTable from "./WizardSessionsTable";
import { journeyFromRow, WIZARD_BUCKETS, WIZARD_SESSION_COLUMNS, type WizardBucket, type WizardJourney } from "@/lib/wizard/journey";

export const dynamic = "force-dynamic";

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; bucket?: string; source?: string; mode?: string; open?: string }>;
}) {
  const { status, bucket, source, mode, open } = await searchParams;
  const supabase = await createClient();

  const { data: tplRow0 } = await supabase.from("settings").select("value").eq("key", "estimate_templates").maybeSingle();
  const templates0: TemplateMeta[] = (Array.isArray(tplRow0?.value) ? (tplRow0!.value as { id: string; name: string }[]) : [])
    .map((t) => ({ id: t.id, name: t.name }));
  const tabs = (
    <div className="mt-4 flex flex-wrap gap-1 border-b border-gray-200">
      {FILTERS.map((f) => {
        const active = (status ?? "all") === f;
        return (
          <Link
            key={f}
            href={f === "all" ? "/estimates" : `/estimates?status=${f}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize ${
              active ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
            data-testid={`estimates-tab-${f}`}
          >
            {f}
          </Link>
        );
      })}
    </div>
  );

  // Buckets brief §5 — the Wizard tab: open sessions (no estimate yet), with
  // bucket / source / mode filters; Ready sorts oldest request first.
  if (status === "wizard") {
    const bucketOk = (WIZARD_BUCKETS as readonly string[]).includes(bucket ?? "") ? (bucket as WizardBucket) : null;
    let q = supabase.from("wizard_drafts").select(WIZARD_SESSION_COLUMNS).is("converted_at", null)
      .order("last_seen_at", { ascending: false }).limit(500);
    if (bucketOk) q = q.eq("bucket", bucketOk);
    if (source) q = q.eq("entry_source", source);
    if (mode === "home" || mode === "business") q = q.eq("mode", mode);
    const { data: rows } = await q;
    const order: Record<string, number> = { ready_call: 0, ready_visit: 0, needs_help: 1, priced_no_request: 2, online_now: 3, dropped: 4 };
    const sessions: WizardJourney[] = ((rows ?? []) as unknown as Record<string, unknown>[]).map(journeyFromRow)
      .sort((a, b) => (order[a.bucket] - order[b.bucket]) || (a.bucket.startsWith("ready")
        ? (a.outcomeAt ?? "").localeCompare(b.outcomeAt ?? "")
        : (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "")));
    const sources = [...new Set(sessions.map((s) => s.entrySource).filter((x): x is string => Boolean(x)))];
    const chip = (label: string, href: string, on: boolean) => (
      <Link key={href} href={href} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{label}</Link>
    );
    const base = (b?: string, s?: string, m?: string) => {
      const p = new URLSearchParams({ status: "wizard" });
      if (b) p.set("bucket", b); if (s) p.set("source", s); if (m) p.set("mode", m);
      return `/estimates?${p.toString()}`;
    };
    return (
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Estimates</h1>
          <NewEstimateButton templates={templates0} />
        </div>
        {tabs}
        <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="wizard-filters">
          <span className="mr-1 text-xs uppercase tracking-wide text-gray-400">Bucket</span>
          {chip("All", base(undefined, source, mode), !bucketOk)}
          {chip("Ready · call", base("ready_call", source, mode), bucketOk === "ready_call")}
          {chip("Ready · visit", base("ready_visit", source, mode), bucketOk === "ready_visit")}
          {chip("Needs help", base("needs_help", source, mode), bucketOk === "needs_help")}
          {chip("Dropped", base("dropped", source, mode), bucketOk === "dropped")}
          {chip("Priced · no request", base("priced_no_request", source, mode), bucketOk === "priced_no_request")}
          {chip("Online now", base("online_now", source, mode), bucketOk === "online_now")}
          <span className="ml-3 mr-1 text-xs uppercase tracking-wide text-gray-400">Mode</span>
          {chip("Home", base(bucket, source, mode === "home" ? undefined : "home"), mode === "home")}
          {chip("Business", base(bucket, source, mode === "business" ? undefined : "business"), mode === "business")}
          {sources.length > 0 && <span className="ml-3 mr-1 text-xs uppercase tracking-wide text-gray-400">Source</span>}
          {sources.map((s) => chip(s, base(bucket, source === s ? undefined : s, mode), source === s))}
        </div>
        <WizardSessionsTable sessions={sessions} openId={open ?? null} />
        <AssistantFab estimateId={null} />
      </div>
    );
  }

  // "Viewed" is sent + the customer's first open (viewed_at) — one DB status,
  // two tabs (Tom, 4 Sep). The row shows "viewed" the same way.
  const fq = filterQuery(status);
  let query = supabase
    .from("estimates")
    .select("id, title, status, total_cents, created_at, viewed_at")
    .order("created_at", { ascending: false });
  if (fq.status) query = query.eq("status", fq.status);
  if (fq.viewed === true) query = query.not("viewed_at", "is", null);
  if (fq.viewed === false) query = query.is("viewed_at", null);
  const { data: estimates, error: listError } = await query;

  // Buckets brief §5: the wizard session behind each listed estimate. Read
  // the converted sessions newest-first rather than `in(ids)` — a thousand
  // uuids on the query string is longer than the request line allows.
  const { data: sessionRows } = await supabase.from("wizard_drafts").select(WIZARD_SESSION_COLUMNS)
    .not("estimate_id", "is", null).order("last_seen_at", { ascending: false }).limit(1000);
  const sessionOf = new Map<string, WizardJourney>();
  for (const r of ((sessionRows ?? []) as unknown as Record<string, unknown>[])) {
    const j = journeyFromRow(r);
    if (j.estimateId && !sessionOf.has(j.estimateId)) sessionOf.set(j.estimateId, j);
  }
  const rowsWithWizard = (estimates ?? []).map((e) => ({ ...e, wizard: sessionOf.get(e.id as string) ?? null }));

  const templates = templates0;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Estimates</h1>
        <NewEstimateButton templates={templates} />
      </div>

      {tabs}

      {listError ? (
        // A failed read is not "no estimates" — say what happened (6 Sep: the
        // list came back empty on the test project under load and read as none).
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800" data-testid="estimates-error">
          The estimates list could not be loaded: {listError.message}. Reload the page.
        </div>
      ) : estimates && estimates.length > 0 ? (
        <EstimatesTable estimates={rowsWithWizard as EstimateRow[]} />
      ) : (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
          No estimates{status && status !== "all" ? ` marked “${status}”` : ""} yet.{" "}
          <Link href="/quote" className="font-medium text-gray-700 hover:underline">
            Create one →
          </Link>
        </div>
      )}
      <AssistantFab estimateId={null} />
    </div>
  );
}
